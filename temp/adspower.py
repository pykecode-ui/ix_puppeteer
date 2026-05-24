"""
Automação Playwright + AdsPower Local API: abre perfil, pesquisa no Google,
localiza anúncios de texto na SERP (blocos #tads / #tadsb e slots data-text-ad).

Modo actual: não clica em anúncios. Para cada keyword em queries.txt, abre a SERP,
inspeciona todos os anúncios visíveis por contêiner ``data-text-ad="1"``, captura PNG
do bloco e envia ao Telegram com URL de exibição. Após processar todas as keywords,
fecha o navegador, aguarda 16 segundos e inicia nova rodada.

Rodadas: SEARCH_ROUNDS (ou set_search_rounds). Com ``RESTART_BROWSER_EACH_ROUND=True`` (defeito):
cada rodada = API ``start`` → trabalho → ``browser.close`` + API ``stop`` (cookies do perfil mantêm-se no AdsPower;
o script **não** chama limpeza de cookies). IP por rodada: ``POST /api/v2/browser-profile/list``.
Com ``RESTART_BROWSER_EACH_ROUND=False``: um único ``start``; entre rodadas ``clear_browser_for_new_round``
(ROUND_CLEANUP_MODE ``none`` / ``tabs_only`` / ``full``).

Otimização de tráfego/proxy: pesquisa directa ``/search?q=…`` (SEARCH_DIRECT_URL_TO_SERP), whitelist em cache por mtime,
colheita visual da SERP e esperas orientadas a estado (URL/selector ``wait_for_*`` em vez de sleeps longos),
e micro-pausas na SERP (SERP_POST_LOAD_SLEEP_*).

A lógica de anúncios espelha google_ad_clicker.py (AdClicker._get_ad_links /
_get_ad_links_by_slots): links com data-pcu dentro dos blocos patrocinados.

AdsPower Local API — definir neste ficheiro e/ou variáveis de ambiente:
  ADSPOWER_API_KEY, ADSPOWER_API_BASE, ADSPOWER_PROFILE_ID (user_id do perfil, igual para mobile/desktop)
  ou ADSPOWER_PROFILE_NO (número de série na lista de perfis). Env com o mesmo nome sobrepõem as constantes.

Opcional:
  ADSPOWER_RESTART_BROWSER_EACH_ROUND=0|1 — legado; neste modo o main força reinício por rodada.

Palavras-chave: apenas o ficheiro queries.txt na mesma pasta que adspower.py
(uma consulta por linha; linhas vazias e linhas que começam por # são ignoradas).
O registo do perfil no AdsPower mantém-se; com reinício por rodada o **processo** do browser fecha e abre
de cada vez. ``stop_profile`` no ``finally`` garante fecho se ainda estiver activo.

whitelist.txt (opcional): mesma pasta; regras por linha. Se uma substring (sem
distinguir maiúsculas) aparecer no URL de clique, URL decodificado, data-pcu,
texto de exibição (cite / data-dtld) ou título do anúncio, esse anúncio não é
processado pelo coletor legado de links — ver google_ad_clicker._ad_match_whitelist_skip.

2Captcha (reCAPTCHA): mesma API que google_ad_clicker.CaptchaSolver.
  Chave: constante TWOCAPTCHA_API_KEY neste ficheiro (ver secção de configuração abaixo).

Telegram (opcional): URLs de exibição (cite / data-dtld) e, se activo, capturas PNG das áreas
``#tads`` / ``#tadsb`` / shopping (estilo google_ad_clicker). Só constantes ``ADSPOWER_TELEGRAM_*`` neste ficheiro.
"""

from __future__ import annotations

import os
import random
import re
import sys
import time
from html import escape
from threading import Thread
from typing import Optional
from urllib.parse import parse_qs, parse_qsl, quote, quote_plus, unquote, urlencode, urlparse, urljoin, urlunparse

import requests
from playwright.sync_api import Locator, Page, sync_playwright
from playwright.sync_api import TimeoutError as PlaywrightTimeoutError

# --- AdsPower (API local) — preencher aqui; não é lido de .env ---
ADSPOWER_API_BASE = "http://local.adspower.net:50325"
ADSPOWER_API_KEY = "9aabe651d52360f22fef96bc06dfb38e00784dcf1a341d17"
# user_id na coluna «ID» do AdsPower (não o nome do perfil). Perfis mobile usam o mesmo identificador na API.k1bt1sm4
ADSPOWER_PROFILE_ID = "k1bxgr9f"
# Opcional: número de série (coluna «N.º» / profile_no). Usado só se ``ADSPOWER_PROFILE_ID`` e o env estiverem vazios.
ADSPOWER_PROFILE_NO = ""

LOCAL_API_BASE = (ADSPOWER_API_BASE or "http://local.adspower.net:50325").rstrip("/")
API_KEY = (ADSPOWER_API_KEY or "").strip()

_SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
QUERIES_FILE = os.path.join(_SCRIPT_DIR, "queries.txt")
WHITELIST_FILE = os.path.join(_SCRIPT_DIR, "whitelist.txt")

# Chave API 2Captcha (reCAPTCHA v2). Definir só aqui — não é lida de .env nem de config.json.
TWOCAPTCHA_API_KEY = "a5b86f6fa7e0507f8b5c7dd8e1a23350"

# --- Telegram (AdsPower): só neste ficheiro — não lê config.json nem google_ad_clicker ---
# ``True`` + token + chat_id: após detectar anúncios, envia capturas SERP (opcional) + mensagem com links.
ADSPOWER_TELEGRAM_SEND_DISPLAY_LINKS = True
ADSPOWER_TELEGRAM_BOT_TOKEN = "8563288788:AAEVK8mYYm3z56XdlI4lHJC195M1_AfUfzI"
ADSPOWER_TELEGRAM_CHAT_ID = "5813456505"
# Captura PNG dos blocos de anúncio na SERP (topo/rodapé/shopping) e envia via Telegram antes dos cliques.
ADSPOWER_TELEGRAM_INCLUDE_AD_SCREENSHOTS = True

# Cliques no primeiro anúncio por pesquisa (defeito em código). Env ADSPOWER_CLICKS_PER_AD ou set_clicks_per_ad substituem.
CLICKS_PER_AD_DEFAULT = 20
_CLICKS_PER_AD_OVERRIDE: Optional[int] = None

# Tempo máximo esperado para N Ctrl+cliques num único anúncio (alerta se ultrapassar).
MAX_SECONDS_PER_AD_N_CLICKS = 40.0

# Pausa entre Ctrl+cliques consecutivos no mesmo anúncio (aba principal mantida).
AD_CTRL_CLICK_GAP_MIN = 0.05
AD_CTRL_CLICK_GAP_MAX = 0.12
# Pausa antes do 1.º Ctrl+clique de cada anúncio (scroll + estabilização do DOM).
AD_AD_FIRST_CLICK_SLEEP_MIN = 0.08
AD_AD_FIRST_CLICK_SLEEP_MAX = 0.18
# Timeout para o browser registar o popup aberto pelo Ctrl+clique.
AD_EXPECT_POPUP_TIMEOUT_MS = 6_000
# Timeout do Ctrl+clique no locator (ms).
AD_LOCATOR_CLICK_TIMEOUT_MS = 7_000
# True: desactiva o último fallback ``context.new_page()``+``goto`` (só aberturas estilo Ctrl+clique).
AD_USE_CTRL_ONLY_OPENS = False
# True: não espera carregamento extra nas abas acumuladas (fecham-se todas no fim do burst).
AD_SKIP_NEW_TAB_LOAD_WAIT = True
# Novo separador (tetos para fallback).
AD_NEW_TAB_LOAD_WAIT = "commit"
AD_NEW_TAB_LOAD_TIMEOUT_MS = 5_000
# Pausa breve após fechar todas as abas acumuladas (antes do próximo anúncio).
AD_AFTER_BURST_CLOSE_SLEEP_MIN = 0.08
AD_AFTER_BURST_CLOSE_SLEEP_MAX = 0.18

# Repetir todo o fluxo de queries.txt sem fechar o perfil AdsPower (poupa aberturas diárias).
SEARCH_ROUNDS = 50
_SEARCH_ROUNDS_OVERRIDE: Optional[int] = None
PAUSE_BETWEEN_ROUNDS_MIN = 16.0
PAUSE_BETWEEN_ROUNDS_MAX = 16.0

# True: cada rodada abre e fecha o browser via API (start/stop); cookies **não** são limpos pelo script.
# Env ADSPOWER_RESTART_BROWSER_EACH_ROUND=0|1 sobrepõe.
RESTART_BROWSER_EACH_ROUND = True
# Pausa mínima entre chamadas Local API (ex.: após ``start`` antes de ``list``; após ``stop`` antes do próximo ``start``).
ADSPOWER_LOCAL_API_GAP_SEC = 1.15

# --- Tráfego / proxy (pesquisa) ---
# True: um único ``goto`` para ``/search?q=...`` em vez de google.com → preencher q → Enter (menos saltos HTTP).
SEARCH_DIRECT_URL_TO_SERP = True
# Reserva mínima após ``ec_wait_serp_markers_attached`` (só se quiser micro-estabilização).
SERP_POST_LOAD_SLEEP_MIN = 0.03
SERP_POST_LOAD_SLEEP_MAX = 0.08
# Pausas ao colher anúncios (scroll na mesma página — não é proxy, mas reduz tempo total na sessão).
SERP_AD_HARVEST_SCROLL_PAUSE_MIN = 0.18
SERP_AD_HARVEST_SCROLL_PAUSE_MAX = 0.38
# Só usado se RESTART_BROWSER_EACH_ROUND=False. "none" / "tabs_only": fecha separadores extra, **sem** limpar cookies.
# "full": cookies + storage + cache (mais tráfego na próxima ida ao Google).
ROUND_CLEANUP_MODE = "none"  # "none" | "tabs_only" | "full"

# Google lento, proxy ou CDP: margem maior evita TimeoutError genérico.
_GOOGLE_GOTO_MS = 120_000
_GOOGLE_UI_MS = 90_000

# Mesmos XPaths de slots de texto que google_ad_clicker.AdClicker.AD_SLOT_XPATHS
_AD_SLOT_XPATHS: tuple[tuple[str, str], ...] = (
    ("slot_top_1", '//div[@data-ta-slot="0" and @data-ta-slot-pos="1" and @data-text-ad="1"]'),
    ("slot_top_2", '//div[@data-ta-slot="0" and @data-ta-slot-pos="2" and @data-text-ad="1"]'),
    ("slot_top_3", '//div[@data-ta-slot="0" and @data-ta-slot-pos="3" and @data-text-ad="1"]'),
    ("slot_bottom_1", '//div[@data-ta-slot="3" and @data-ta-slot-pos="1" and @data-text-ad="1"]'),
    ("slot_bottom_2", '//div[@data-ta-slot="3" and @data-ta-slot-pos="2" and @data-text-ad="1"]'),
    ("ueierd_top", '//div[contains(@class,"uEierd") and @data-text-ad="1" and @data-ta-slot="0"]'),
    ("ueierd_bottom", '//div[contains(@class,"uEierd") and @data-text-ad="1" and @data-ta-slot="3"]'),
    ("generic_text_ad", '//div[@data-text-ad="1"]'),
)

# --- Esperas explícitas (equivalente a Selenium ExpectedConditions + WebDriverWait curto) ---
_GOOGLE_SEARCH_BOX_SEL = 'textarea[name="q"], input[name="q"]'
_EC_SERP_MARKERS = "#search, #rso, #result-stats, #botstuff"
_EC_UI_MS = 14_000
_EC_MICRO_MS = 2_000
_SERP_URL_RE = re.compile(r"https?://([^/]*\.)?google\.[^/]+/search")


def ec_wait_search_box_visible(page: Page, *, timeout_ms: Optional[int] = None) -> Locator:
    """Condição: caixa de pesquisa Google visível."""
    to = int(timeout_ms if timeout_ms is not None else _EC_UI_MS)
    loc = page.locator(_GOOGLE_SEARCH_BOX_SEL).first
    loc.wait_for(state="visible", timeout=to)
    return loc


def ec_wait_serp_markers_attached(page: Page, *, timeout_ms: Optional[int] = None) -> None:
    """Condição: blocos típicos da SERP presentes na DOM (evita sleep longo após ``goto``)."""
    to = int(timeout_ms if timeout_ms is not None else _EC_UI_MS)
    try:
        page.wait_for_selector(_EC_SERP_MARKERS, state="attached", timeout=to)
    except PlaywrightTimeoutError:
        try:
            page.wait_for_load_state("domcontentloaded", timeout=min(to, 8_000))
        except PlaywrightTimeoutError:
            pass


def ec_wait_serp_url_or_markers(page: Page, *, timeout_ms: Optional[int] = None) -> None:
    """Condição: URL de pesquisa ou marcadores SERP (o que ocorrer primeiro)."""
    to = int(timeout_ms if timeout_ms is not None else _EC_UI_MS)
    try:
        page.wait_for_url(_SERP_URL_RE, timeout=to)
        return
    except PlaywrightTimeoutError:
        pass
    ec_wait_serp_markers_attached(page, timeout_ms=to)


def ec_scroll_locator_ready(loc: Locator, *, timeout_ms: int = 6_000) -> None:
    """Condição: locator visível + scroll into view."""
    loc.wait_for(state="visible", timeout=timeout_ms)
    loc.scroll_into_view_if_needed(timeout=timeout_ms)


def human_sleep(a: float = 0.8, b: float = 2.0) -> None:
    time.sleep(random.uniform(a, b))


def _url_is_chrome_error(url: str) -> bool:
    u = (url or "").strip().lower()
    return u.startswith("chrome-error:") or "chromewebdata" in u


def _goto_error_recoverable(exc: BaseException) -> bool:
    t = str(exc).lower()
    return (
        "interrupted" in t
        or "chrome-error" in t
        or "chromewebdata" in t
        or "net::err" in t
        or " err_" in t
        or "target page, context or browser has been closed" in t
    )


def page_goto_robust(
    page: Page,
    url: str,
    *,
    timeout_ms: Optional[int] = None,
    wait_until: str = "domcontentloaded",
    attempts: int = 6,
) -> None:
    """
    ``page.goto`` com retentativas. AdsPower/proxy/CDP costuma gerar
    ``chrome-error://chromewebdata/`` ou "Navigation … interrupted by another navigation".
    """
    to = int(timeout_ms if timeout_ms is not None else _GOOGLE_GOTO_MS)
    last_exc: Optional[BaseException] = None
    for attempt in range(1, attempts + 1):
        try:
            cur = (page.url or "").strip()
            if _url_is_chrome_error(cur):
                print(
                    f"[goto] Separador em erro do Chrome ({cur[:72]}…); "
                    f"nova tentativa {attempt}/{attempts} após pausa."
                )
                human_sleep(2.0, 4.5)
            wu = wait_until
            if attempt >= 4:
                wu = "commit"
            page.goto(url, wait_until=wu, timeout=to)
            if wu == "commit":
                try:
                    page.wait_for_load_state("domcontentloaded", timeout=min(to, 90_000))
                except PlaywrightTimeoutError:
                    pass
            after = (page.url or "").strip()
            if _url_is_chrome_error(after):
                print(f"[goto] Após goto ainda em chrome-error; tentativa {attempt}/{attempts}.")
                last_exc = RuntimeError(f"Página de erro: {after[:100]}")
                human_sleep(2.5, 5.0)
                continue
            return
        except PlaywrightTimeoutError as e:
            last_exc = e
            print(f"[goto] Timeout a ir para {url[:60]}… (tentativa {attempt}/{attempts})")
            if attempt >= attempts:
                break
            human_sleep(2.0, 4.0)
        except Exception as e:
            last_exc = e
            if _goto_error_recoverable(e) and attempt < attempts:
                print(f"[goto] {e!s} (tentativa {attempt}/{attempts})")
                human_sleep(2.0, 4.5)
                continue
            raise
    raise RuntimeError(
        f"Navegação para {url[:80]!r} falhou após {attempts} tentativas. "
        "Verifique proxy/rede do perfil AdsPower e se o separador não está em chrome-error://."
    ) from last_exc


def _tab_open_modifier() -> list[str]:
    """Ctrl+clique (Win/Linux) ou Cmd+clique (macOS) para abrir em novo separador, como o clicker."""
    return ["Meta"] if sys.platform == "darwin" else ["Control"]


def _ad_post_switch_settle() -> None:
    """Pausa após o novo separador abrir e carregar (aleatório entre AD_NEW_TAB_SETTLE_*)."""
    lo = float(AD_NEW_TAB_SETTLE_MIN)
    hi = float(AD_NEW_TAB_SETTLE_MAX)
    if hi < lo:
        lo, hi = hi, lo
    time.sleep(random.uniform(lo, hi))


def clear_browser_for_new_round(main_page: Page) -> None:
    """
    Entre rodadas de pesquisa (sessão CDP única): fecha separadores extra; opcionalmente limpa cookies,
    cache HTTP e storage (ROUND_CLEANUP_MODE). ``none`` e ``tabs_only`` **não** limpam cookies.
    """
    ctx = main_page.context
    for pg in list(ctx.pages):
        if pg != main_page:
            try:
                pg.close()
            except Exception:
                pass
    try:
        main_page.bring_to_front()
    except Exception:
        pass
    mode = (ROUND_CLEANUP_MODE or "full").strip().lower()
    if mode in ("none", "tabs_only"):
        return
    try:
        ctx.clear_cookies()
    except Exception:
        pass
    for pg in list(ctx.pages):
        try:
            pg.evaluate(
                "() => { try { localStorage.clear(); sessionStorage.clear(); } catch (e) {} }"
            )
        except Exception:
            pass
    try:
        sess = ctx.new_cdp_session(main_page)
        sess.send("Network.clearBrowserCache", {})
        sess.send("Network.clearBrowserCookies", {})
    except Exception:
        pass


# ---------------------------------------------------------------------------
# 2Captcha — espelho de google_ad_clicker.CaptchaSolver + integração Playwright
# ---------------------------------------------------------------------------


class CaptchaSolver:
    """Cliente 2Captcha para reCAPTCHA v2 / Enterprise (userrecaptcha + enterprise=1)."""

    IN_URL = "https://2captcha.com/in.php"
    RES_URL = "https://2captcha.com/res.php"
    HTTP_HEADERS = {
        "Accept": "application/json,text/plain,*/*",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Python-requests/2Captcha",
    }
    FATAL = frozenset(
        {
            "ERROR_WRONG_USER_KEY",
            "ERROR_KEY_DOES_NOT_EXIST",
            "ERROR_ZERO_BALANCE",
            "IP_BANNED",
            "ERROR_GOOGLEKEY",
            "ERROR_CAPTCHA_UNSOLVABLE",
            "ERROR_WRONG_GOOGLEKEY",
        }
    )

    def __init__(self, apikey: str) -> None:
        self.apikey = apikey.strip()

    def solve_recaptcha(
        self,
        sitekey: str,
        page_url: str,
        data_s: Optional[str] = None,
        cookies: Optional[str] = None,
        *,
        enterprise: bool = False,
    ) -> Optional[str]:
        params: dict[str, str] = {
            "key": self.apikey,
            "method": "userrecaptcha",
            "googlekey": sitekey,
            "pageurl": page_url,
            "json": "1",
        }
        if enterprise:
            params["enterprise"] = "1"
        if data_s:
            params["data-s"] = data_s
        if cookies:
            params["cookies"] = cookies

        req_id = self._submit(params)
        if not req_id:
            return None
        mode = "Enterprise" if enterprise else "v2"
        print(f"[2captcha] Enviado ({mode}, ID: {req_id}). A aguardar resolução…")
        time.sleep(12)
        return self._poll(req_id)

    def get_balance(self) -> Optional[float]:
        try:
            r = requests.get(
                self.RES_URL,
                params={"key": self.apikey, "action": "getbalance", "json": 1},
                timeout=10,
            )
            d = r.json()
            if d.get("status") == 1:
                return float(d["request"])
        except Exception:
            pass
        return None

    def _submit(self, params: dict[str, str]) -> Optional[str]:
        for attempt in range(12):
            try:
                # POST evita 414 quando pageurl/data-s/cookies tornam a query string grande.
                r = requests.post(
                    self.IN_URL,
                    data=params,
                    headers=self.HTTP_HEADERS,
                    timeout=45,
                )
                t = r.text.strip()
                try:
                    d = r.json()
                except Exception:
                    d = None
                if isinstance(d, dict) and "status" in d:
                    if int(d.get("status", 0)) == 1:
                        rid = str(d.get("request", "")).strip()
                        if rid:
                            return rid
                    msg = str(d.get("request", d)).strip()
                    print(f"[2captcha] Envio recusado: {msg}")
                    if any(e in msg for e in self.FATAL):
                        return None
                    if "NO_SLOT" in msg.upper():
                        time.sleep(6)
                        continue
                    return None
                if any(e in t for e in self.FATAL):
                    print(f"[2captcha] Erro fatal: {t[:300]}")
                    return None
                if "ERROR_NO_SLOT" in t:
                    time.sleep(6)
                    continue
                if t.startswith("OK|"):
                    return t.split("|", 1)[1]
                if t:
                    print(f"[2captcha] Resposta inesperada no envio: {t[:300]}")
                return None
            except Exception as ex:
                print(f"[2captcha] Falha de rede no envio (tentativa {attempt + 1}): {ex}")
                time.sleep(4)
        return None

    def _poll(self, req_id: str) -> Optional[str]:
        for i in range(55):
            try:
                r = requests.get(
                    self.RES_URL,
                    params={
                        "key": self.apikey,
                        "action": "get",
                        "id": req_id,
                        "json": "1",
                    },
                    headers=self.HTTP_HEADERS,
                    timeout=45,
                )
                t = r.text.strip()
                try:
                    d = r.json()
                except Exception:
                    d = None
                if isinstance(d, dict) and int(d.get("status", 0)) == 1:
                    token = str(d.get("request", "")).strip()
                    if token and len(token) > 20:
                        print("[2captcha] Resolvido!")
                        return token
                if isinstance(d, dict):
                    msg = str(d.get("request", "")).strip()
                    if "NOT_READY" in msg.upper() or "CAPCHA_NOT_READY" in msg.upper():
                        time.sleep(5 if i < 8 else 6)
                        continue
                    if msg and msg != "CAPCHA_NOT_READY":
                        print(f"[2captcha] Resposta get: {msg[:400]}")
                    if any(e in msg for e in self.FATAL):
                        return None
                    if msg.upper().startswith("ERROR_"):
                        return None
                if "CAPCHA_NOT_READY" in t or "CAPCHA_NOT_READY" in t.upper():
                    time.sleep(5 if i < 8 else 6)
                    continue
                if t.startswith("OK|"):
                    print("[2captcha] Resolvido!")
                    return t.split("|", 1)[1]
                if t and not t.startswith("OK|"):
                    # Às vezes o endpoint devolve HTML (Cloudflare/nginx/etc.) em vez da API.
                    # Isso não significa que o job falhou; aguarda e tenta novamente.
                    preview = " ".join(t[:240].split())
                    print(f"[2captcha] Poll não-API/HTML (tentativa {i + 1}/55): {preview}")
                    time.sleep(8 if i < 8 else 12)
                    continue
            except Exception as ex:
                print(f"[2captcha] Falha de rede no poll: {ex}")
                time.sleep(4)
        print("[2captcha] Timeout: demasiadas tentativas de poll sem token.")
        return None


def build_captcha_solver() -> Optional[CaptchaSolver]:
    """Constrói CaptchaSolver se TWOCAPTCHA_API_KEY estiver definida neste módulo."""
    key = (TWOCAPTCHA_API_KEY or "").strip()
    if not key:
        return None
    return CaptchaSolver(key)


def _cookies_header_for_2captcha(page) -> Optional[str]:
    """Cookie header (name=value; …) para o parâmetro ``cookies`` da API 2Captcha."""
    try:
        pairs = [f"{c['name']}={c['value']}" for c in page.context.cookies()]
        return "; ".join(pairs) if pairs else None
    except Exception:
        return None


def page_has_recaptcha_challenge(page) -> bool:
    """Espelho de AdClicker._page_has_recaptcha_challenge (Playwright)."""
    try:
        loc = page.locator("[data-sitekey]")
        if loc.count() > 0:
            sk = (loc.first.get_attribute("data-sitekey") or "").strip()
            if sk:
                return True
    except Exception:
        pass
    try:
        if (
            page.locator(
                "iframe[src*='recaptcha'], iframe[src*='gstatic.com/recaptcha'], iframe[title*='reCAPTCHA']"
            ).count()
            > 0
        ):
            return True
    except Exception:
        pass
    return False


def find_recaptcha_sitekey_and_s(page) -> tuple[Optional[str], Optional[str], bool]:
    """
    Devolve (sitekey, data-s, enterprise).

    Na SERP o sitekey muitas vezes só aparece no ``src`` do iframe (parâmetro ``k=``),
    não em ``data-sitekey`` — daí a extração via JavaScript.
    """
    for sel in ("#recaptcha", ".g-recaptcha", "div[data-sitekey]"):
        try:
            loc = page.locator(sel)
            if loc.count() == 0:
                continue
            el = loc.first
            sk = (el.get_attribute("data-sitekey") or "").strip()
            if sk:
                data_s = (el.get_attribute("data-s") or "").strip() or None
                ent = False
                try:
                    if loc.first.locator("iframe[src*='enterprise']").count() > 0:
                        ent = True
                except Exception:
                    pass
                return sk, data_s, ent
        except Exception:
            continue
    try:
        info = page.evaluate(
            """
() => {
  let enterprise = false;
  const iframes = document.querySelectorAll(
    "iframe[src*='recaptcha'], iframe[src*='gstatic.com/recaptcha'], iframe[src*='google.com/recaptcha']"
  );
  for (const f of iframes) {
    const src = f.getAttribute("src") || "";
    if (/enterprise/i.test(src)) enterprise = true;
  }
  for (const el of document.querySelectorAll("[data-sitekey]")) {
    const k = (el.getAttribute("data-sitekey") || "").trim();
    if (k) {
      const ds = (el.getAttribute("data-s") || "").trim();
      return { sitekey: k, dataS: ds || null, enterprise };
    }
  }
  for (const f of iframes) {
    const src = f.getAttribute("src") || "";
    if (/enterprise/i.test(src)) enterprise = true;
    try {
      const u = new URL(src, location.href);
      const k = u.searchParams.get("k");
      if (k) {
        const s = u.searchParams.get("s");
        return { sitekey: k.trim(), dataS: s ? s.trim() : null, enterprise };
      }
    } catch (e) {}
  }
  return { sitekey: null, dataS: null, enterprise: false };
}
"""
        )
        if isinstance(info, dict):
            sk = (str(info.get("sitekey") or "")).strip()
            if sk:
                ds = info.get("dataS")
                data_s = (str(ds).strip() if ds else None) or None
                return sk, data_s, bool(info.get("enterprise"))
    except Exception:
        pass
    return None, None, False


def _url_with_recaptcha_response(url: str, token: str) -> str:
    """Acrescenta g-recaptcha-response à query (equivalente ao get do clicker)."""
    parts = urlparse(url)
    qlist = parse_qsl(parts.query, keep_blank_values=True)
    qdict = dict(qlist)
    qdict["g-recaptcha-response"] = token
    new_query = urlencode(qdict)
    return urlunparse(parts._replace(query=new_query))


def try_solve_recaptcha_if_present(page, solver: Optional[CaptchaSolver]) -> bool:
    """
    Se a página tiver reCAPTCHA, resolve com 2Captcha e navega com o token.
    Devolve False se houver captcha e não foi possível resolver.
    """
    try:
        page.wait_for_load_state("domcontentloaded", timeout=_EC_MICRO_MS)
    except PlaywrightTimeoutError:
        pass
    if not page_has_recaptcha_challenge(page):
        return True
    if not solver:
        print(
            "[2captcha] reCAPTCHA detetado, mas sem chave API — "
            "defina a constante TWOCAPTCHA_API_KEY em adspower.py."
        )
        return False

    sitekey, data_s, enterprise = find_recaptcha_sitekey_and_s(page)
    if not sitekey:
        print("[2captcha] reCAPTCHA (iframe) visível, mas sitekey não encontrado no DOM.")
        return False

    print(
        f"[2captcha] A resolver reCAPTCHA (sitekey …{sitekey[-8:]}, "
        f"{'Enterprise' if enterprise else 'v2'})…"
    )
    cookies = _cookies_header_for_2captcha(page)
    token = solver.solve_recaptcha(
        sitekey, page.url, data_s, cookies, enterprise=enterprise
    )
    if not token:
        alt = not enterprise
        print(
            f"[2captcha] Sem token — retentativa como "
            f"{'Enterprise' if alt else 'v2 clássico'}…"
        )
        token = solver.solve_recaptcha(
            sitekey, page.url, data_s, cookies, enterprise=alt
        )
    if not token:
        print(
            "[2captcha] Não foi obtido token. Confirme saldo 2Captcha, chave API, "
            "e que o tipo de captcha (v2 vs Enterprise) corresponde à página."
        )
        return False

    target = _url_with_recaptcha_response(page.url, token)
    page_goto_robust(page, target, timeout_ms=_GOOGLE_GOTO_MS)
    ec_wait_serp_url_or_markers(page, timeout_ms=_EC_UI_MS)
    print("[2captcha] Token aplicado.")
    return True


def set_clicks_per_ad(count: int) -> None:
    """
    Quantas tentativas de clique **por anúncio** numa consulta (ex.: 20 no 1.º anúncio, 20 no 2.º, …).
    As abas abertas no burst fecham-se **todas ao fim das N tentativas** desse anúncio, não uma a uma.
    Sobrepõe ADSPOWER_CLICKS_PER_AD até o processo terminar.
    """
    global _CLICKS_PER_AD_OVERRIDE
    if count < 1 or count > 50:
        raise ValueError("count deve estar entre 1 e 50")
    _CLICKS_PER_AD_OVERRIDE = count


def get_clicks_per_ad() -> int:
    """Número de cliques por anúncio: set_clicks_per_ad, senão env ADSPOWER_CLICKS_PER_AD, senão CLICKS_PER_AD_DEFAULT."""
    if _CLICKS_PER_AD_OVERRIDE is not None:
        return _CLICKS_PER_AD_OVERRIDE
    raw = (os.getenv("ADSPOWER_CLICKS_PER_AD") or "").strip()
    if not raw:
        return max(1, min(50, CLICKS_PER_AD_DEFAULT))
    try:
        n = int(raw)
    except ValueError:
        return max(1, min(50, CLICKS_PER_AD_DEFAULT))
    return max(1, min(50, n))


def set_search_rounds(n: int) -> None:
    """Define quantas vezes repetir todas as linhas de queries.txt sem fechar o perfil (1–500)."""
    global _SEARCH_ROUNDS_OVERRIDE
    if n < 1 or n > 500:
        raise ValueError("Rodadas devem estar entre 1 e 500")
    _SEARCH_ROUNDS_OVERRIDE = n


def get_search_rounds() -> int:
    """Rodadas de pesquisa: set_search_rounds, senão constante SEARCH_ROUNDS."""
    if _SEARCH_ROUNDS_OVERRIDE is not None:
        return max(1, min(500, _SEARCH_ROUNDS_OVERRIDE))
    return max(1, min(500, int(SEARCH_ROUNDS)))


def load_ad_whitelist_patterns(path: str) -> list[str]:
    """
    Lê whitelist.txt: uma regra por linha (como google_ad_clicker.load_ad_whitelist_patterns).
    Linhas vazias ou que começam por # são ignoradas. Comparação case-insensitive, substring.
    """
    if not os.path.isfile(path):
        return []
    out: list[str] = []
    try:
        with open(path, encoding="utf-8", errors="replace") as fh:
            for line in fh:
                s = line.strip()
                if not s or s.startswith("#"):
                    continue
                out.append(s)
    except OSError:
        return []
    return out


_WHITELIST_MTIME_PATTERNS: Optional[tuple[float, list[str]]] = None


def get_whitelist_patterns_cached(path: str) -> list[str]:
    """
    Lê whitelist.txt no máximo uma vez por alteração ao ficheiro (mtime).
    Evita I/O e re-parse em cada ``find_google_text_ad_candidates`` (antes: N× por consulta).
    """
    global _WHITELIST_MTIME_PATTERNS
    if not path or not os.path.isfile(path):
        return []
    try:
        mtime = os.path.getmtime(path)
    except OSError:
        return load_ad_whitelist_patterns(path)
    if _WHITELIST_MTIME_PATTERNS is not None and _WHITELIST_MTIME_PATTERNS[0] == mtime:
        return _WHITELIST_MTIME_PATTERNS[1]
    pats = load_ad_whitelist_patterns(path)
    _WHITELIST_MTIME_PATTERNS = (mtime, pats)
    return pats


def _ad_whitelist_haystack(loc: Locator) -> str:
    """Texto agregado do anúncio para testar substrings (href, pcu, cite, dtld, título)."""
    try:
        return loc.evaluate(
            r"""(el) => {
                const bits = [];
                const add = (s) => {
                    const t = (s && String(s).trim()) || "";
                    if (t) bits.push(t);
                };
                add(el.getAttribute("href"));
                add(el.getAttribute("data-pcu"));
                add(el.getAttribute("aria-label"));
                const card =
                    el.closest('[data-text-ad="1"]') ||
                    el.closest("[data-text-ad]") ||
                    el.closest(".uEierd");
                const root = card || el;
                const head = root.querySelector('[role="heading"]');
                if (head) add(head.innerText);
                const grabDt = (node) => {
                    node.querySelectorAll("cite, span[data-dtld], [data-dtld]").forEach((n) => {
                        const t = (n.innerText || "").trim();
                        if (t) bits.push(t);
                    });
                };
                grabDt(el);
                if (root !== el) grabDt(root);
                return bits.join(" ").toLowerCase();
            }"""
        )
    except Exception:
        return ""


def ad_should_skip_for_whitelist(loc: Locator, href: str, patterns: list[str]) -> bool:
    """
    True = não clicar neste anúncio (alguma regra coincide), alinhado a
    google_ad_clicker._ad_match_whitelist_skip.
    """
    if not patterns:
        return False
    decoded = decode_google_serp_href(href or "").lower()
    hay = (_ad_whitelist_haystack(loc) + " " + decoded).strip()
    for raw in patterns:
        p = (raw or "").strip().lower()
        if not p or p.startswith("#"):
            continue
        if p in hay:
            return True
    return False


def filter_whitelisted_ad_candidates(
    candidates: list[tuple[Locator, str, str]],
    patterns: list[str],
) -> list[tuple[Locator, str, str]]:
    """Remove anúncios que coincidem com whitelist.txt (mantém ordem)."""
    if not patterns:
        return list(candidates)
    kept: list[tuple[Locator, str, str]] = []
    for loc, href, label in candidates:
        if ad_should_skip_for_whitelist(loc, href, patterns):
            prev = (href or "")[:100]
            print(f"  [whitelist] ignorar anúncio ({label}) — {prev!s}")
            continue
        kept.append((loc, href, label))
    return kept


def load_search_keywords() -> list[str]:
    """
    Lê somente ``queries.txt`` na pasta do projeto (ao lado de ``adspower.py``).
    Uma palavra-chave por linha; ignora linhas vazias e comentários (# no início).
    """
    if not os.path.isfile(QUERIES_FILE):
        raise RuntimeError(
            f"queries.txt não encontrado. Crie o ficheiro em:\n  {QUERIES_FILE}\n"
            "com uma consulta por linha."
        )
    lines: list[str] = []
    try:
        with open(QUERIES_FILE, encoding="utf-8", errors="replace") as fh:
            for ln in fh:
                s = ln.strip()
                if not s or s.startswith("#"):
                    continue
                lines.append(s)
    except OSError as e:
        raise RuntimeError(f"Não foi possível ler queries.txt: {e}") from e

    if not lines:
        raise RuntimeError(
            f"queries.txt não tem palavras-chave válidas (vazio ou só comentários):\n  {QUERIES_FILE}"
        )
    return lines


def _api_headers() -> dict[str, str]:
    if not API_KEY:
        raise RuntimeError(
            "Defina a constante ADSPOWER_API_KEY em adspower.py (chave da API local do AdsPower)."
        )
    return {"Authorization": f"Bearer {API_KEY}"}


def _browser_profile_identity() -> dict[str, str]:
    """
    Corpo mínimo para ``start``/``stop``: ``profile_id`` (user_id) ou ``profile_no``.
    Env ``ADSPOWER_PROFILE_ID`` / ``ADSPOWER_PROFILE_NO`` sobrepõem as constantes do ficheiro.
    """
    pid = (os.getenv("ADSPOWER_PROFILE_ID") or ADSPOWER_PROFILE_ID or "").strip()
    pno = (os.getenv("ADSPOWER_PROFILE_NO") or ADSPOWER_PROFILE_NO or "").strip()
    if pid:
        return {"profile_id": pid}
    if pno:
        return {"profile_no": pno}
    return {}


def _pick_automation_page(browser):
    """
    Escolhe uma aba utilizável no navegador AdsPower.
    A primeira aba do CDP costuma ser extensão, devtools ou about:blank preso — aí o campo q nunca fica clicável.
    """
    skip_prefixes = (
        "chrome-extension://",
        "devtools://",
        "chrome-devtools://",
    )
    usable = []
    for ctx in browser.contexts:
        for pg in ctx.pages:
            u = (pg.url or "").strip().lower()
            if u.startswith(skip_prefixes):
                continue
            if _url_is_chrome_error(pg.url or ""):
                continue
            usable.append(pg)

    def _prefer(page_list: list) -> object:
        for pg in page_list:
            u = (pg.url or "").strip().lower()
            if _url_is_chrome_error(pg.url or ""):
                continue
            if u.startswith("http://") or u.startswith("https://"):
                return pg
        return page_list[0]

    if usable:
        chosen = _prefer(usable)
        try:
            chosen.bring_to_front()
        except Exception:
            pass
        return chosen

    ctx = browser.contexts[0] if browser.contexts else browser.new_context()
    return ctx.new_page()


def start_profile() -> str:
    ident = _browser_profile_identity()
    if not ident:
        raise RuntimeError(
            "Defina ADSPOWER_PROFILE_ID (coluna «ID» / user_id no AdsPower) ou ADSPOWER_PROFILE_NO (número de série). "
            "Pode usar as variáveis de ambiente com o mesmo nome. "
            "Perfis mobile usam o mesmo tipo de ID na Local API — não existe ID separado «mobile»; "
            "confirme que não colou o nome do perfil em vez do ID."
        )

    headers = _api_headers()
    # Alinhado à documentação oficial: evita restaurar abas antigas e a página de detecção de proxy.
    payload = {
        **ident,
        "last_opened_tabs": "0",
        "proxy_detection": "0",
    }
    _ik, _iv = next(iter(ident.items()))
    print(f"[AdsPower] Pedido start ({_ik}={_iv!r})…")

    resp = requests.post(
        f"{LOCAL_API_BASE}/api/v2/browser-profile/start",
        headers=headers,
        json=payload,
        timeout=30,
    )
    resp.raise_for_status()
    data = resp.json()

    print("Resposta AdsPower:")
    print(data)

    if data.get("code") != 0:
        raise RuntimeError(f"Erro AdsPower: {data.get('msg')}")

    ws = (data.get("data") or {}).get("ws") or {}
    puppeteer = ws.get("puppeteer")
    if not puppeteer:
        raise RuntimeError("Resposta sem data.ws.puppeteer; verifique a versão do AdsPower e a API v2.")
    endpoint = str(puppeteer).strip()
    if endpoint.startswith("http://") or endpoint.startswith("https://"):
        endpoint = endpoint.replace("http://", "ws://", 1).replace("https://", "wss://", 1)
    return endpoint


def stop_profile() -> None:
    ident = _browser_profile_identity()
    if not ident or not API_KEY:
        return

    headers = _api_headers()
    try:
        resp = requests.post(
            f"{LOCAL_API_BASE}/api/v2/browser-profile/stop",
            headers=headers,
            json=ident,
            timeout=15,
        )
        if resp.ok:
            body = resp.json()
            if body.get("code") != 0:
                print(f"AdsPower stop aviso: {body.get('msg')}")
        else:
            print(f"AdsPower stop HTTP {resp.status_code}: {resp.text[:200]}")
    except Exception as e:
        print(f"Falha ao fechar perfil no AdsPower: {e}")


def _restart_browser_each_round_enabled() -> bool:
    raw = (os.getenv("ADSPOWER_RESTART_BROWSER_EACH_ROUND") or "").strip().lower()
    if raw in ("0", "false", "no", "off"):
        return False
    if raw in ("1", "true", "yes", "on"):
        return True
    return bool(RESTART_BROWSER_EACH_ROUND)


def print_profile_ip_from_adspower_api(*, round_idx: int, rounds: int) -> None:
    """Imprime ``ip`` / ``ip_country`` devolvidos por ``POST /api/v2/browser-profile/list``."""
    ident = _browser_profile_identity()
    if not ident or not API_KEY:
        print(
            f"[rodada {round_idx}/{rounds}] IP (API list): — "
            "(sem profile_id/profile_no ou ADSPOWER_API_KEY)"
        )
        return
    gap = max(float(ADSPOWER_LOCAL_API_GAP_SEC), 0.45)
    time.sleep(gap)
    headers = _api_headers()
    body: dict[str, object] = {"page": 1, "limit": 10}
    if "profile_id" in ident:
        body["profile_id"] = [ident["profile_id"]]
    else:
        body["profile_no"] = [ident["profile_no"]]
    try:
        resp = requests.post(
            f"{LOCAL_API_BASE}/api/v2/browser-profile/list",
            headers=headers,
            json=body,
            timeout=30,
        )
        resp.raise_for_status()
        data = resp.json()
    except Exception as e:
        print(f"[rodada {round_idx}/{rounds}] IP (API list): erro — {e}")
        return
    if data.get("code") != 0:
        print(f"[rodada {round_idx}/{rounds}] IP (API list): {data.get('msg')!r}")
        return
    lst = (data.get("data") or {}).get("list") or []
    if not lst:
        print(f"[rodada {round_idx}/{rounds}] IP (API list): lista vazia")
        return
    row = lst[0]
    ip = str(row.get("ip") or "").strip()
    country = str(row.get("ip_country") or "").strip()
    name = str(row.get("name") or "").strip()
    tail = f"  nome_perfil={name!r}" if name else ""
    print(
        f"[rodada {round_idx}/{rounds}] IP (API browser-profile/list): "
        f"{ip or '—'}  país={country or '—'}{tail}"
    )


def _playwright_connect_pick_page(p, ws_endpoint: str):
    browser = p.chromium.connect_over_cdp(ws_endpoint)
    deadline = time.time() + 20.0
    while time.time() < deadline and not browser.contexts:
        time.sleep(0.05)
    if not browser.contexts:
        raise RuntimeError(
            "Nenhum contexto CDP após conectar ao AdsPower; confirme o perfil e a versão do cliente."
        )
    while time.time() < deadline and not browser.contexts[0].pages:
        time.sleep(0.05)
    page = _pick_automation_page(browser)
    return browser, page


def _harvestable_serp_ad_href(href: str) -> bool:
    """
    True se o href pode ser clique de anúncio na SERP.
    O Google usa muitas vezes /url?... (relativo) — o código antigo só aceitava http(s).
    """
    h = (href or "").strip()
    if not h or h.startswith("#") or h.lower().startswith("javascript:"):
        return False
    if h.startswith("/url"):
        return True
    if h.startswith("//"):
        return True
    if not h.startswith("http"):
        return False
    lo = h.lower()
    if "support.google.com" in lo or "policies.google.com" in lo:
        return False
    return True


def decode_google_serp_href(href: str) -> str:
    """
    Converte href da SERP (incl. redirecionamento /url?q=...) na URL final do site.
    """
    if not href:
        return ""
    href = href.strip()
    parsed = urlparse(href)
    host = (parsed.netloc or "").lower()
    path = parsed.path or ""

    path_norm = (path or "").replace("//", "/")
    path_clean = path_norm.rstrip("/") or "/"
    # Relativo /url?... na própria página de resultados (netloc vazio).
    if path_clean == "/url" and ("google." in host or not host):
        qs = parse_qs(parsed.query)
        for key in ("q", "url"):
            if key in qs and qs[key]:
                return unquote(qs[key][0]).strip()
    return href


# --- Telegram (credenciais nas constantes ADSPOWER_TELEGRAM_* no topo) ---


def _telegram_display_credentials() -> tuple[str, str]:
    return (ADSPOWER_TELEGRAM_BOT_TOKEN or "").strip(), str(ADSPOWER_TELEGRAM_CHAT_ID or "").strip()


def _should_send_telegram_display_links() -> bool:
    if not ADSPOWER_TELEGRAM_SEND_DISPLAY_LINKS:
        return False
    t, c = _telegram_display_credentials()
    return bool(t and c)


def _inject_telegram_ad_frame_style(page: Page) -> None:
    """CSS temporário para realçar o recorte (equivalente a google_ad_clicker._inject_vintage_ad_frame_style)."""
    try:
        page.evaluate(
            r"""
            () => {
                const id = 'gac-vintage-ad-frame-css';
                if (document.getElementById(id)) return;
                const st = document.createElement('style');
                st.id = id;
                st.textContent =
                  '.gac-vintage-ad-frame{' +
                  'outline:4px double #5B3A1A!important;' +
                  'outline-offset:6px!important;' +
                  'box-shadow:0 0 0 2px #C4A574, inset 0 0 28px rgba(60,40,10,0.1)!important;' +
                  'border-radius:3px!important;' +
                  'filter:sepia(0.06)!important;' +
                  '}';
                document.head.appendChild(st);
            }
            """
        )
    except Exception:
        pass


def _playwright_border_shot_locator(loc: Locator) -> Optional[bytes]:
    """PNG de um bloco (moldura breve); None se indisponível."""
    try:
        if loc.count() == 0:
            return None
    except Exception:
        return None
    first = loc.first
    try:
        first.evaluate(
            """(el) => { el.scrollIntoView({ block: 'center', behavior: 'instant' }); }"""
        )
        human_sleep(0.32, 0.42)
        try:
            if not first.is_visible(timeout=2_000):
                return None
        except Exception:
            return None
        box = first.bounding_box()
        if not box or float(box.get("width") or 0) < 24 or float(box.get("height") or 0) < 24:
            return None
        first.evaluate("""(el) => { el.classList.add('gac-vintage-ad-frame'); }""")
        human_sleep(0.18, 0.26)
        return first.screenshot(type="png", timeout=15_000)
    except Exception:
        return None
    finally:
        try:
            first.evaluate("""(el) => { el.classList.remove('gac-vintage-ad-frame'); }""")
        except Exception:
            pass


def _capture_ad_slot_screenshot(loc: Locator) -> Optional[bytes]:
    """
    Captura PNG do contêiner pai ``data-text-ad='1'`` (ou ``.uEierd``) do anchor ``loc``.
    Sobe o DOM via JS até 12 níveis; se não encontrar o contêiner usa o próprio anchor.
    Aplica a moldura de destaque e remove-a após a captura.
    Devolve None em caso de erro ou elemento invisível/muito pequeno.
    """
    try:
        # Subir DOM para obter o ElementHandle do contêiner de anúncio
        handle = loc.evaluate_handle(
            """(el) => {
                let n = el;
                for (let i = 0; i < 12; i++) {
                    if (!n || !n.parentElement) break;
                    n = n.parentElement;
                    if ((n.dataset && n.dataset.textAd === '1') ||
                        (n.classList && n.classList.contains('uEierd'))) return n;
                }
                return el;
            }"""
        )
        el = handle.as_element()
        if el is None:
            return None
        try:
            el.scroll_into_view_if_needed(timeout=3_000)
        except Exception:
            pass
        human_sleep(0.28, 0.42)
        box = el.bounding_box()
        if not box or float(box.get("width") or 0) < 24 or float(box.get("height") or 0) < 24:
            return None
        try:
            el.evaluate("""(el) => { el.classList.add('gac-vintage-ad-frame'); }""")
            human_sleep(0.15, 0.22)
        except Exception:
            pass
        try:
            png = el.screenshot(type="png", timeout=12_000)
            return png
        finally:
            try:
                el.evaluate("""(el) => { el.classList.remove('gac-vintage-ad-frame'); }""")
            except Exception:
                pass
    except Exception:
        return None


def capture_serp_ad_area_screenshots(page: Page) -> list[tuple[str, bytes]]:
    """
    (rótulo, PNG) por área: ``#tads``, ``#tadsb``, primeiro shopping (pla/cu).
    Espelha google_ad_clicker._capture_ad_area_screenshots.
    """
    out: list[tuple[str, bytes]] = []
    if not ADSPOWER_TELEGRAM_INCLUDE_AD_SCREENSHOTS:
        return out
    _inject_telegram_ad_frame_style(page)
    try:
        page.evaluate("() => window.scrollTo(0, 0)")
    except Exception:
        pass
    human_sleep(0.38, 0.52)
    png = _playwright_border_shot_locator(page.locator("#tads"))
    if png:
        out.append(("Topo (#tads)", png))
    try:
        page.evaluate(
            "() => window.scrollTo(0, Math.max(0, document.body.scrollHeight - window.innerHeight))"
        )
    except Exception:
        pass
    human_sleep(0.48, 0.62)
    png = _playwright_border_shot_locator(page.locator("#tadsb"))
    if png:
        out.append(("Rodapé (#tadsb)", png))
    try:
        page.evaluate("() => window.scrollTo(0, 0)")
    except Exception:
        pass
    human_sleep(0.30, 0.42)
    for sel, lab in (
        (".pla-unit-container", "Shopping (PLA)"),
        (".cu-container", "Shopping (cu)"),
    ):
        png = _playwright_border_shot_locator(page.locator(sel))
        if png:
            out.append((lab, png))
            break
    return out


def _telegram_fallback_viewport_png(page: Page) -> Optional[tuple[str, bytes]]:
    """Último recurso: viewport (equivalente a get_screenshot_as_png no clicker)."""
    try:
        raw = page.screenshot(type="png", full_page=False, timeout=30_000)
        if raw:
            return ("Viewport (fallback)", raw)
    except Exception:
        pass
    return None


def _compact_telegram_text(value: object, limit: int = 120) -> str:
    text = " ".join(str(value or "").split())
    if len(text) <= limit:
        return text
    return text[: max(0, limit - 1)] + "…"


def _append_unique_href_rows(
    rows: list[tuple[str, str]], href: str, label: str
) -> None:
    h = (href or "").strip()
    if not h:
        return
    for rh, _ in rows:
        if rh == h:
            return
    rows.append((h, (label or h).strip() or h))


def _telegram_clickable_link_html(href: str, label: str, display_max: int = 72) -> str:
    u = (href or "").strip()
    if not u:
        return ""
    safe_href = escape(u, quote=True)
    safe_lab = escape(_compact_telegram_text(label or u, display_max))
    return f'<a href="{safe_href}">{safe_lab}</a>'


def _build_limited_telegram_html(lines: list[str], limit: int = 4096) -> str:
    selected: list[str] = []
    for line in lines:
        candidate = "\n".join(selected + [line]).strip()
        if len(candidate) <= limit:
            selected.append(line)
            continue
        ellipsis = "…"
        candidate = "\n".join(selected + [ellipsis]).strip()
        if len(candidate) <= limit:
            selected.append(ellipsis)
        break
    return "\n".join(selected).strip()


def _display_url_to_href_and_label(display: str, fallback_href: str) -> tuple[str, str]:
    """
    href clicável + legenda: prioriza texto de exibição da SERP (cite / breadcrumb ›);
    se não der para montar URL, usa decode_google_serp_href(fallback).
    """
    dec = decode_google_serp_href(fallback_href).strip()
    d = (display or "").strip()
    if not d:
        return dec, _compact_telegram_text(dec, 90)
    label = _compact_telegram_text(d, 100)
    primary = d.split("›")[0].strip().replace(" ", "")
    if primary.lower().startswith(("http://", "https://")):
        return primary, label
    if "." in primary and len(primary) < 220 and "\n" not in primary:
        if not primary.startswith("."):
            return f"https://{primary.lstrip('/')}", label
    return dec, label


def extract_google_ad_display_url_text(loc: Locator) -> str:
    """Texto de exibição do anúncio (cite / data-dtld) no cartão SERP, vazio se não existir."""
    try:
        s = loc.evaluate(
            r"""(el) => {
                const card =
                    el.closest('[data-text-ad="1"]') ||
                    el.closest("[data-text-ad]") ||
                    el.closest(".uEierd");
                const root = card || el;
                const pick = (node) => {
                    for (const sel of ["cite", "span[data-dtld]", "[data-dtld]"]) {
                        try {
                            for (const n of node.querySelectorAll(sel)) {
                                const t = (n.innerText || "").trim();
                                if (t) return t;
                            }
                        } catch (e) {}
                    }
                    return "";
                };
                let d = pick(el);
                if (!d && root !== el) d = pick(root);
                return d || "";
            }"""
        )
        return (s or "").strip()
    except Exception:
        return ""


def collect_telegram_display_link_rows(
    candidates: list[tuple[Locator, str, str]],
) -> list[tuple[str, str]]:
    """
    Para cada anúncio: (href_clicável, rótulo_exibição).
    Ordem = ordem na SERP; href deduplicado.
    """
    rows: list[tuple[str, str]] = []
    for loc, href, _slot_label in candidates:
        disp = extract_google_ad_display_url_text(loc)
        link_href, link_label = _display_url_to_href_and_label(disp, href)
        _append_unique_href_rows(rows, link_href, link_label)
    return rows


def _telegram_ads_links_html_body(keyword: str, rows: list[tuple[str, str]]) -> str:
    lines = [
        "🎯 <b>AdsPower</b> — links de exibição (anúncios na SERP)",
        f"🔎 <b>Query:</b> {escape(str(keyword or '-'))}",
        "",
    ]
    for i, (href, label) in enumerate(rows[:40], 1):
        hl = _telegram_clickable_link_html(href, label)
        if hl:
            lines.append(f"{i}. {hl}")
    return _build_limited_telegram_html(lines, 3900)


def _telegram_photo_caption_header(keyword: str, part_label: str = "") -> str:
    bits = [
        "🎯 <b>AdsPower</b> — área de anúncios",
        f"🔎 <b>Query:</b> {escape(str(keyword or '-'))}",
    ]
    if part_label:
        bits.append(part_label)
    return _build_limited_telegram_html(bits, 1024)


def _send_telegram_photo_sync(token: str, chat_id: str, photo: bytes, caption: str) -> None:
    url_photo = f"https://api.telegram.org/bot{token}/sendPhoto"
    files = {"photo": ("serp_ads.png", photo, "image/png")}
    data = {
        "chat_id": chat_id,
        "parse_mode": "HTML",
        "caption": (caption or "")[:1024],
    }
    requests.post(url_photo, data=data, files=files, timeout=60)


def _send_telegram_ads_notification_sync(
    keyword: str,
    rows: list[tuple[str, str]],
    screenshots: list[tuple[str, bytes]],
) -> None:
    token, chat_id = _telegram_display_credentials()
    if not token or not chat_id:
        return
    if not rows and not screenshots:
        return

    for shot_label, png in screenshots[:3]:
        cap = _telegram_photo_caption_header(
            keyword,
            f"📍 {escape(shot_label)}",
        )
        _send_telegram_photo_sync(token, chat_id, png, cap)

    if rows:
        body = _telegram_ads_links_html_body(keyword, rows)
        url_msg = f"https://api.telegram.org/bot{token}/sendMessage"
        requests.post(
            url_msg,
            json={"chat_id": chat_id, "text": body, "parse_mode": "HTML"},
            timeout=30,
        )


def notify_telegram_ad_display_links_async(
    page: Page,
    keyword: str,
    candidates: list[tuple[Locator, str, str]],
) -> None:
    """
    Colhe links de exibição e, se ``ADSPOWER_TELEGRAM_INCLUDE_AD_SCREENSHOTS``, capturas
    das áreas de anúncio na SERP; envia no Telegram (fotos + mensagem com links).

    A captura corre na thread principal antes dos Ctrl+cliques; o envio HTTP é em daemon.
    """
    if not _should_send_telegram_display_links():
        return
    try:
        rows = collect_telegram_display_link_rows(candidates)
    except Exception as ex:
        print(f"[telegram:ads] Falha ao colher URLs de exibição: {ex}")
        return
    if not rows:
        return

    screenshots: list[tuple[str, bytes]] = []
    if ADSPOWER_TELEGRAM_INCLUDE_AD_SCREENSHOTS:
        try:
            screenshots = capture_serp_ad_area_screenshots(page)
            if not screenshots:
                fb = _telegram_fallback_viewport_png(page)
                if fb:
                    screenshots = [fb]
        except Exception as ex:
            print(f"[telegram:ads] Falha na captura SERP: {ex}")

    frozen_kw = str(keyword or "")
    frozen_rows = list(rows)
    frozen_shots = list(screenshots)

    def _worker() -> None:
        try:
            _send_telegram_ads_notification_sync(frozen_kw, frozen_rows, frozen_shots)
            extra = f" + {len(frozen_shots)} captura(s)" if frozen_shots else ""
            print(f"[telegram:ads] Notificação enviada (links{extra}).")
        except Exception as e:
            print(f"[telegram:ads] Falha ao enviar: {e}")

    Thread(target=_worker, daemon=True).start()


# ---------------------------------------------------------------------------
# Módulo de Inspeção de Slots (bloqueante, por anúncio individual)
# ---------------------------------------------------------------------------

def _send_ad_slot_telegram_sync(
    token: str,
    chat_id: str,
    keyword: str,
    ad_idx: int,
    total_ads: int,
    label: str,
    href: str,
    png: Optional[bytes],
    display_url: str = "",
) -> bool:
    """
    Envia UM anúncio ao Telegram de forma síncrona.
    Legenda inclui URL de exibição (``cite`` / ``data-dtld`` do card Google).
    Devolve True se o HTTP retornou 2xx.
    """
    safe_kw = escape(str(keyword or "-"))
    safe_label = escape(str(label or ""))

    caption_lines = [
        f"🎯 <b>Anúncio {ad_idx}/{total_ads}</b> — AdsPower",
        f"🔎 <b>Query:</b> {safe_kw}",
        f"📍 <b>Posição:</b> {safe_label}",
    ]

    # URL de exibição (o que aparece no card Google: "advertiser.com › página")
    disp = (display_url or "").strip()
    if disp:
        caption_lines.append(f"🌐 <b>Exibição:</b> {escape(_compact_telegram_text(disp, 80))}")

    caption = _build_limited_telegram_html(caption_lines, 1024)

    try:
        if png:
            resp = requests.post(
                f"https://api.telegram.org/bot{token}/sendPhoto",
                data={"chat_id": chat_id, "parse_mode": "HTML", "caption": caption[:1024]},
                files={"photo": (f"ad_{ad_idx}.png", png, "image/png")},
                timeout=60,
            )
        else:
            resp = requests.post(
                f"https://api.telegram.org/bot{token}/sendMessage",
                json={"chat_id": chat_id, "text": caption, "parse_mode": "HTML"},
                timeout=30,
            )
        return 200 <= resp.status_code < 300
    except Exception as ex:
        print(f"[telegram:slots] Erro HTTP ao enviar anúncio {ad_idx}/{total_ads}: {ex}")
        return False


def _collect_unique_ad_containers(page: Page) -> list[tuple[Locator, str, str]]:
    """
    Varre a SERP de forma independente (topo → rodapé) e devolve exatamente
    **um contêiner** ``data-text-ad='1'`` por anúncio físico, cobrindo todos
    os slots (topo, rodapé, posições intermédias).

    Diferente de ``find_google_text_ad_candidates``, esta função:
    - Trabalha diretamente com o **contêiner** (não com âncoras), eliminando
      falsos-negativos causados por ``href in seen``.
    - Deduplica por **posição absoluta no documento** (scrollY + rect.top),
      independente do estado de rolagem no momento da chamada.
    - Atribui rótulos legíveis baseados em ``data-ta-slot`` / ``data-ta-slot-pos``.

    Devolve lista de ``(container_locator, href_principal, rótulo)``.
    """
    out: list[tuple[Locator, str, str]] = []
    seen_keys: set[str] = set()

    def _harvest_page_containers() -> None:
        containers = page.locator('xpath=//div[@data-text-ad="1"]')
        try:
            nc = min(containers.count(), 60)
        except Exception:
            return
        for i in range(nc):
            c = containers.nth(i)
            try:
                # Posição absoluta no documento (independente da rolagem)
                key = c.evaluate(
                    """(el) => {
                        const scrollY = window.pageYOffset
                            || document.documentElement.scrollTop || 0;
                        const r = el.getBoundingClientRect();
                        return `${Math.round(r.top + scrollY)},`
                             + `${Math.round(r.left)},${Math.round(r.width)}`;
                    }"""
                )
                if not key or key in seen_keys:
                    continue
                seen_keys.add(key)

                # Link principal: data-pcu > primeiro <a>
                primary = c.locator("a[data-pcu]")
                if primary.count() > 0:
                    href = (primary.first.get_attribute("href") or "").strip()
                else:
                    first_a = c.locator("a").first
                    href = (first_a.get_attribute("href") or "").strip()

                if not href:
                    continue

                # Rótulo legível baseado nos atributos do slot
                ta_slot = (c.get_attribute("data-ta-slot") or "").strip()
                ta_pos = (c.get_attribute("data-ta-slot-pos") or "").strip()
                if ta_slot == "0":
                    label = f"Topo — pos {ta_pos}" if ta_pos else "Topo"
                elif ta_slot == "3":
                    label = f"Rodapé — pos {ta_pos}" if ta_pos else "Rodapé"
                elif ta_slot:
                    label = f"Slot {ta_slot} pos {ta_pos}" if ta_pos else f"Slot {ta_slot}"
                else:
                    # Fallback: detectar pelo bloco pai (#tads / #tadsb)
                    parent_id = c.evaluate(
                        """(el) => {
                            let n = el.parentElement;
                            for (let i = 0; i < 10; i++) {
                                if (!n) break;
                                if (n.id === 'tads') return 'tads';
                                if (n.id === 'tadsb') return 'tadsb';
                                n = n.parentElement;
                            }
                            return '';
                        }"""
                    )
                    if parent_id == "tads":
                        label = "Topo (#tads)"
                    elif parent_id == "tadsb":
                        label = "Rodapé (#tadsb)"
                    else:
                        label = "Anúncio"

                out.append((c, href, label))
            except Exception:
                continue

    # Passagem 1 — topo da página
    try:
        page.evaluate("() => window.scrollTo(0, 0)")
    except Exception:
        pass
    human_sleep(0.20, 0.32)
    _harvest_page_containers()

    # Passagem 2 — rodapé da página (pode revelar anúncios lazy-loaded)
    try:
        page.evaluate(
            "() => window.scrollTo(0, Math.max(0, document.body.scrollHeight - window.innerHeight))"
        )
    except Exception:
        pass
    human_sleep(0.28, 0.42)
    _harvest_page_containers()

    return out


def inspect_and_notify_ad_slots_blocking(
    page: Page,
    keyword: str,
    candidates: list[tuple[Locator, str, str]],
) -> bool:
    """
    Módulo de inspeção SERP — três etapas sequenciais e bloqueantes:

    1. **Identificação e Captura**: varre a SERP diretamente via
       ``_collect_unique_ad_containers`` (independente do pipeline de âncoras),
       cobrindo todos os slots — topo, rodapé e posições intermédias.
       Um print por contêiner ``data-text-ad='1'`` físico.

    2. **Envio em lote ao Telegram (ação bloqueadora)**: envia UM ``sendPhoto``
       (ou ``sendMessage`` se a captura falhou) por anúncio, contendo
       ``[Screenshot Anúncio] + [Link do Anúncio]``. Bloqueia até que
       TODOS os envios terminem.

    3. **Liberação da pesquisa**: devolve ``True`` após confirmação do envio
       completo; o fluxo segue para a próxima keyword sem clicar em anúncios.

    O parâmetro ``candidates`` é mantido para compatibilidade com a assinatura
    mas não é utilizado na colheita — a inspecção usa ``_collect_unique_ad_containers``.
    Devolve ``False`` se pelo menos um envio falhou (a próxima keyword prossegue mesmo assim).
    """
    if not _should_send_telegram_display_links():
        print(
            "[telegram:slots] Notificações desactivadas ou credenciais em falta — "
            "a prosseguir para a próxima etapa sem inspecção."
        )
        return True

    token, chat_id = _telegram_display_credentials()

    # Colheita independente: varre todos os data-text-ad containers na SERP
    print("\n[telegram:slots] ── INSPEÇÃO SERP ── a varrer todos os slots …")
    unique = _collect_unique_ad_containers(page)
    total = len(unique)

    if total == 0:
        print("[telegram:slots] Nenhum contêiner data-text-ad='1' encontrado — a prosseguir sem cliques.")
        return True

    print(
        f"[telegram:slots] {total} anúncio(s) único(s) encontrado(s) "
        f"({', '.join(set(lbl for _, _, lbl in unique))}).\n"
        f"[telegram:slots] Etapa 1: capturando screenshots individuais …"
    )
    _inject_telegram_ad_frame_style(page)

    # ── Etapa 1: captura screenshots + extrai URLs antes de qualquer envio ──────
    # Tuple: (loc, href, label, png, display_url)
    captures: list[tuple[Locator, str, str, Optional[bytes], str]] = []
    for idx, (loc, href, label) in enumerate(unique, start=1):
        print(f"[telegram:slots]   [{idx}/{total}] {label} …", end=" ", flush=True)

        # Screenshot do contêiner
        png = _capture_ad_slot_screenshot(loc)
        size_info = f"{len(png) // 1024} KB" if png else "sem captura"

        # URL de exibição (cite / data-dtld do card Google)
        try:
            display_url = extract_google_ad_display_url_text(loc)
        except Exception:
            display_url = ""

        print(f"{size_info}  exib={_compact_telegram_text(display_url, 40) or '—'}")
        captures.append((loc, href, label, png, display_url))

    # ── Etapa 2: envio em lote (bloqueante) ───────────────────────────────────
    print(f"[telegram:slots] Etapa 2: enviando {total} anúncio(s) ao Telegram …")
    all_ok = True
    for idx, (loc, href, label, png, display_url) in enumerate(captures, start=1):
        ok = _send_ad_slot_telegram_sync(
            token, chat_id, keyword, idx, total, label, href, png,
            display_url=display_url,
        )
        status_icon = "✓" if ok else "⚠"
        print(f"[telegram:slots]   [{idx}/{total}] {status_icon} {label}")
        if not ok:
            all_ok = False

    # ── Etapa 3: liberação ────────────────────────────────────────────────────
    batch_status = "concluído" if all_ok else "concluído com falhas"
    print(
        f"[telegram:slots] Etapa 2 {batch_status}. "
        f"Etapa 3: seguindo para a próxima consulta sem clicar nos {total} anúncio(s).\n"
    )
    return all_ok


def _absolute_serp_ad_href(page: Page, href: str) -> str:
    """URL absoluto para ``goto`` / novo separador a partir do ``href`` do anúncio na SERP."""
    h = (href or "").strip()
    if not h:
        return ""
    if h.startswith("//"):
        return "https:" + h
    if h.startswith("/"):
        try:
            base = (page.url or "").strip() or "https://www.google.com/"
            return urljoin(base, h)
        except Exception:
            return h
    return h


def accept_google_cookies(page) -> None:
    selectors = [
        'button:has-text("Aceitar tudo")',
        'button:has-text("Aceitar todos")',
        'button:has-text("Accept all")',
        'button:has-text("I agree")',
        'button:has-text("Reject all")',
        'button:has-text("Recusar tudo")',
        '[aria-label="Aceitar tudo"]',
        '[aria-label="Accept all"]',
    ]

    for frame in page.frames:
        for sel in selectors:
            try:
                locator = frame.locator(sel)
                if locator.count() > 0:
                    locator.first.click(timeout=4000)
                    try:
                        page.wait_for_load_state("domcontentloaded", timeout=_EC_MICRO_MS)
                    except PlaywrightTimeoutError:
                        pass
                    return
            except Exception:
                pass


def _fill_google_query_and_submit(page, search_box, keyword: str) -> None:
    """
    O combobox da homepage (textarea gLFyf) com sugestões (aria-expanded) costuma fazer
    Locator.click travar no CDP — mesmo com force=True. Evita click: fill forçado, setter
    nativo se React não refletir, e Enter pelo teclado da página.
    """
    for _ in range(2):
        try:
            page.keyboard.press("Escape")
        except Exception:
            pass
        human_sleep(0.05, 0.14)

    try:
        search_box.fill(keyword, force=True, timeout=_GOOGLE_UI_MS)
    except PlaywrightTimeoutError:
        pass

    current = ""
    try:
        current = search_box.input_value(timeout=8_000)
    except Exception:
        pass

    if current != keyword:
        search_box.evaluate(
            """(el, text) => {
                const proto = el instanceof HTMLTextAreaElement
                    ? window.HTMLTextAreaElement.prototype
                    : window.HTMLInputElement.prototype;
                const desc = Object.getOwnPropertyDescriptor(proto, "value");
                if (desc && desc.set) {
                    desc.set.call(el, text);
                } else {
                    el.value = text;
                }
                el.dispatchEvent(new Event("input", { bubbles: true }));
                el.dispatchEvent(new Event("change", { bubbles: true }));
                el.focus();
            }""",
            keyword,
        )

    page.keyboard.press("Enter")
    ec_wait_serp_url_or_markers(page, timeout_ms=_EC_UI_MS)


def _serp_wait_ready(page, captcha_solver: Optional[CaptchaSolver]) -> None:
    """Espera URL/DOM típicos da SERP e resolve reCAPTCHA se aparecer."""
    try:
        page.wait_for_url(_SERP_URL_RE, timeout=_EC_UI_MS)
    except PlaywrightTimeoutError:
        pass
    try:
        page.wait_for_selector(_EC_SERP_MARKERS, state="attached", timeout=_EC_UI_MS)
    except PlaywrightTimeoutError:
        try:
            page.wait_for_load_state("domcontentloaded", timeout=min(_EC_UI_MS, 10_000))
        except PlaywrightTimeoutError:
            pass

    if not try_solve_recaptcha_if_present(page, captcha_solver):
        raise RuntimeError("reCAPTCHA na SERP e não foi possível resolver (2Captcha).")


def _do_google_search_via_homepage(
    page,
    keyword: str,
    *,
    captcha_solver: Optional[CaptchaSolver],
) -> None:
    """Fluxo clássico: google.com → caixa de pesquisa → Enter (mais um round-trip que a URL directa)."""
    page_goto_robust(page, "https://www.google.com/", timeout_ms=_GOOGLE_GOTO_MS)
    ec_wait_search_box_visible(page, timeout_ms=_EC_UI_MS)

    if not try_solve_recaptcha_if_present(page, captcha_solver):
        raise RuntimeError("reCAPTCHA na página inicial e não foi possível resolver (2Captcha).")

    accept_google_cookies(page)
    ec_wait_search_box_visible(page, timeout_ms=_EC_UI_MS)

    if not try_solve_recaptcha_if_present(page, captcha_solver):
        raise RuntimeError("reCAPTCHA após o consentimento e não foi possível resolver (2Captcha).")

    try:
        search_box = ec_wait_search_box_visible(page, timeout_ms=_EC_UI_MS)
    except PlaywrightTimeoutError:
        accept_google_cookies(page)
        search_box = ec_wait_search_box_visible(page, timeout_ms=_EC_UI_MS)

    ec_scroll_locator_ready(search_box, timeout_ms=8_000)
    _fill_google_query_and_submit(page, search_box, keyword)
    _serp_wait_ready(page, captcha_solver)


def do_google_search(
    page,
    keyword: str,
    *,
    captcha_solver: Optional[CaptchaSolver] = None,
) -> None:
    page.set_default_timeout(_GOOGLE_UI_MS)

    if SEARCH_DIRECT_URL_TO_SERP:
        q_enc = quote_plus(keyword.strip() or keyword)
        search_url = f"https://www.google.com/search?q={q_enc}&pws=0"
        page_goto_robust(page, search_url, timeout_ms=_GOOGLE_GOTO_MS)
        ec_wait_serp_url_or_markers(page, timeout_ms=_EC_UI_MS)

        if not try_solve_recaptcha_if_present(page, captcha_solver):
            raise RuntimeError("reCAPTCHA após ir directo à SERP e não foi possível resolver (2Captcha).")

        accept_google_cookies(page)
        ec_wait_serp_markers_attached(page, timeout_ms=_EC_UI_MS)

        if not try_solve_recaptcha_if_present(page, captcha_solver):
            raise RuntimeError("reCAPTCHA após consentimento (SERP directa) e não foi possível resolver (2Captcha).")

        _serp_wait_ready(page, captcha_solver)

        u = (page.url or "").lower()
        if "search?q=" not in u and "/search" not in u:
            print(
                "  [proxy] SERP directa não ficou em /search — fallback para google.com + formulário."
            )
            _do_google_search_via_homepage(page, keyword, captcha_solver=captcha_solver)
    else:
        _do_google_search_via_homepage(page, keyword, captcha_solver=captcha_solver)

    ec_wait_serp_markers_attached(page, timeout_ms=_EC_UI_MS)
    human_sleep(float(SERP_POST_LOAD_SLEEP_MIN), float(SERP_POST_LOAD_SLEEP_MAX))


def _harvest_tads_anchors(page, seen: set[str], out: list[tuple[Locator, str, str]]) -> None:
    """Blocos clássicos #tads (topo) e #tadsb (rodapé): div > a; data-pcu quando existe (google_ad_clicker)."""
    for bid, human in (("tads", "Topo — #tads"), ("tadsb", "Rodapé — #tadsb")):
        block = page.locator(f"#{bid}")
        try:
            if block.count() == 0:
                continue
        except Exception:
            continue
        anchors = block.first.locator("div > a")
        try:
            n = min(anchors.count(), 100)
        except Exception:
            continue
        for i in range(n):
            a = anchors.nth(i)
            try:
                href = (a.get_attribute("href") or "").strip()
                if not _harvestable_serp_ad_href(href) or href in seen:
                    continue
                seen.add(href)
                out.append((a, href, human))
            except Exception:
                continue


def _harvest_slot_anchors(page, seen: set[str], out: list[tuple[Locator, str, str]]) -> None:
    """Slots data-ta-slot / data-text-ad; a[data-pcu] ou fallback em <a> (como google_ad_clicker._get_ad_links_by_slots)."""
    for slot_name, xp in _AD_SLOT_XPATHS:
        containers = page.locator(f"xpath={xp}")
        try:
            nc = min(containers.count(), 25)
        except Exception:
            continue
        for i in range(nc):
            container = containers.nth(i)
            try:
                primary = container.locator("a[data-pcu]")
                # Não exigir href^=http: anúncios usam /url?... relativo na SERP.
                if primary.count() > 0:
                    use = primary
                else:
                    use = container.locator("a")
                m = min(use.count(), 40)
            except Exception:
                continue
            for j in range(m):
                a = use.nth(j)
                try:
                    href = (a.get_attribute("href") or "").strip()
                    if not _harvestable_serp_ad_href(href) or href in seen:
                        continue
                    seen.add(href)
                    out.append((a, href, f"Slot {slot_name}"))
                except Exception:
                    continue


def find_google_text_ad_candidates(page) -> list[tuple[Locator, str, str]]:
    """
    Lista candidatos a anúncio de texto (Locator, href bruto, rótulo), na mesma ordem
    de prioridade do AdClicker: #tads/#tadsb com data-pcu, depois slots XPath.
    Faz rolagem topo/rodapé para garantir blocos visíveis.
    """
    out: list[tuple[Locator, str, str]] = []
    seen: set[str] = set()
    lo = float(SERP_AD_HARVEST_SCROLL_PAUSE_MIN)
    hi = float(SERP_AD_HARVEST_SCROLL_PAUSE_MAX)

    try:
        page.evaluate("() => window.scrollTo(0, 0)")
    except Exception:
        pass
    human_sleep(lo, hi)
    _harvest_tads_anchors(page, seen, out)
    _harvest_slot_anchors(page, seen, out)

    try:
        page.evaluate(
            "() => window.scrollTo(0, Math.max(0, document.body.scrollHeight - window.innerHeight))"
        )
    except Exception:
        pass
    human_sleep(lo, hi)
    _harvest_tads_anchors(page, seen, out)
    _harvest_slot_anchors(page, seen, out)

    patterns = get_whitelist_patterns_cached(WHITELIST_FILE)
    return filter_whitelisted_ad_candidates(out, patterns)


def click_google_text_ad(
    page,
    candidate: tuple[Locator, str, str],
    *,
    announce: bool = True,
) -> str:
    """Clica no anúncio no mesmo separador; se o hit-test falhar (CDP), abre o href decodificado."""
    loc, href, label = candidate
    resolved = decode_google_serp_href(href)
    if announce:
        print(f"Anúncio ({label}): {resolved[:160]}")
    ec_scroll_locator_ready(loc, timeout_ms=8_000)
    human_sleep(0.02, 0.06)
    try:
        loc.click(timeout=AD_LOCATOR_CLICK_TIMEOUT_MS, force=True)
    except PlaywrightTimeoutError:
        page_goto_robust(page, resolved, timeout_ms=_GOOGLE_GOTO_MS)
    return resolved


def _wait_new_ad_tab_ready(new_page: Page) -> None:
    """Navegação mínima antes de fechar o separador: ``commit`` + teto curto (mais rápido que 120s DCL)."""
    if AD_SKIP_NEW_TAB_LOAD_WAIT:
        return
    try:
        new_page.wait_for_load_state(
            AD_NEW_TAB_LOAD_WAIT,
            timeout=int(AD_NEW_TAB_LOAD_TIMEOUT_MS),
        )
    except Exception:
        pass


def _ctrl_click_ad_open_background_tab(context, loc: Locator) -> Optional[Page]:
    """
    Um clique **real** no link do anúncio com modificador Ctrl/Cmd: abre novo separador
    e **não navega** no separador da SERP (comportamento igual ao utilizador com Ctrl premido).
    """
    to_pop = int(AD_EXPECT_POPUP_TIMEOUT_MS)
    to_click = int(AD_LOCATOR_CLICK_TIMEOUT_MS)
    mods = _tab_open_modifier()
    try:
        with context.expect_page(timeout=to_pop) as popup:
            loc.click(timeout=to_click, force=True, modifiers=mods)
        new_page = popup.value
        _wait_new_ad_tab_ready(new_page)
        return new_page
    except Exception:
        try:
            with context.expect_page(timeout=to_pop) as popup:
                loc.click(timeout=to_click, modifiers=mods)
            new_page = popup.value
            _wait_new_ad_tab_ready(new_page)
            return new_page
        except Exception:
            return None


def _middle_click_ad_open_background_tab(context, loc: Locator) -> Optional[Page]:
    """Clique do meio no link: em Chromium costuma abrir o anúncio em novo separador sem sair da SERP."""
    to_pop = int(AD_EXPECT_POPUP_TIMEOUT_MS)
    to_click = int(AD_LOCATOR_CLICK_TIMEOUT_MS)
    try:
        with context.expect_page(timeout=to_pop) as popup:
            loc.click(timeout=to_click, force=True, button="middle")
        new_page = popup.value
        _wait_new_ad_tab_ready(new_page)
        return new_page
    except Exception:
        return None


def _open_ad_href_in_new_tab_programmatic(
    context,
    serp_page: Page,
    href: str,
    *,
    skip_post_nav_wait: bool = False,
) -> Optional[Page]:
    """
    Novo separador + ``goto`` no URL do anúncio — não usa a mesma aba da SERP nem ``go_back``.
    Com ``skip_post_nav_wait=True`` (burst rápido): foco volta à SERP sem esperar ``commit``.
    """
    target = _absolute_serp_ad_href(serp_page, href)
    if not target or target.lower().startswith("javascript:"):
        return None
    try:
        p2 = context.new_page()
    except Exception as e:
        print(f"  [anúncio] new_page: {e}")
        return None
    try:
        page_goto_robust(
            p2,
            target,
            wait_until="commit",
            timeout_ms=min(int(_GOOGLE_GOTO_MS), 45_000),
        )
    except Exception as e:
        print(f"  [anúncio] goto no separador extra: {e!s}")
        try:
            p2.close()
        except Exception:
            pass
        return None
    try:
        serp_page.bring_to_front()
    except Exception:
        pass
    if not skip_post_nav_wait:
        _wait_new_ad_tab_ready(p2)
    return p2


def _open_ad_in_new_tab(
    context,
    candidate: tuple[Locator, str, str],
) -> Optional[Page]:
    """
    Abre o anúncio num novo separador (Ctrl/Cmd+clique), alinhado a google_ad_clicker._open_in_new_tab.
    Devolve a nova Page ou None se não abrir separador.
    """
    loc, href, label = candidate
    ec_scroll_locator_ready(loc, timeout_ms=8_000)
    human_sleep(0.02, 0.05)
    return _ctrl_click_ad_open_background_tab(context, loc)


def _reload_serp_after_ad(
    page,
    keyword: str,
    captcha_solver: Optional[CaptchaSolver] = None,
) -> list[tuple[Locator, str, str]]:
    """Volta à página de resultados para repetir o clique no anúncio."""
    try:
        page.go_back(timeout=_GOOGLE_GOTO_MS)
        page.wait_for_load_state("domcontentloaded", timeout=45_000)
        try:
            page.wait_for_url(_SERP_URL_RE, timeout=_EC_UI_MS)
        except PlaywrightTimeoutError:
            pass
        if try_solve_recaptcha_if_present(page, captcha_solver):
            return find_google_text_ad_candidates(page)
        print("  [2captcha] reCAPTCHA após voltar atrás; a refazer a pesquisa.")
        do_google_search(page, keyword, captcha_solver=captcha_solver)
        return find_google_text_ad_candidates(page)
    except Exception as e:
        print(f"  go_back falhou ({e}); a refazer a pesquisa.")
        do_google_search(page, keyword, captcha_solver=captcha_solver)
        return find_google_text_ad_candidates(page)


def _one_ctrl_click_new_tab(context, serp_page: Page, loc: Locator) -> Optional[Page]:
    """
    Abre o destino do anúncio num **novo** separador mantendo a SERP em ``serp_page`` no foco.

    Estratégias (mais fiável → fallback; todas, excepto a última, simulam Ctrl/Cmd ou tecla premida):
    1. ``dispatchEvent`` de clique com ``ctrlKey`` / ``metaKey``.
    1b. ``keyboard.down(Control|Meta)`` + ``click`` + ``keyboard.up`` (tecla realmente premida).
    2. ``loc.click(modifiers=…)``.
    3. ``target=_blank`` + clique.
    4. Só se ``AD_USE_CTRL_ONLY_OPENS`` for False: ``new_page`` + ``goto`` (não é gesto Ctrl).
    """
    to_pop = int(AD_EXPECT_POPUP_TIMEOUT_MS)
    to_click = int(AD_LOCATOR_CLICK_TIMEOUT_MS)
    mods = _tab_open_modifier()
    is_mac = sys.platform == "darwin"

    # ── Estratégia 1: dispatchEvent com ctrlKey/metaKey ──────────────────────
    try:
        with context.expect_page(timeout=to_pop) as popup:
            loc.dispatch_event(
                "click",
                {
                    "bubbles": True,
                    "cancelable": True,
                    "ctrlKey": not is_mac,
                    "metaKey": is_mac,
                },
            )
        new_tab = popup.value
        try:
            serp_page.bring_to_front()
        except Exception:
            pass
        return new_tab
    except Exception:
        pass

    # ── Estratégia 1b: Control/Meta premidos no teclado + clique ──────────────
    key = "Meta" if is_mac else "Control"
    try:
        with context.expect_page(timeout=to_pop) as popup:
            serp_page.keyboard.down(key)
            try:
                loc.click(timeout=to_click, delay=15)
            finally:
                serp_page.keyboard.up(key)
        new_tab = popup.value
        try:
            serp_page.bring_to_front()
        except Exception:
            pass
        return new_tab
    except Exception:
        try:
            serp_page.keyboard.up(key)
        except Exception:
            pass

    # ── Estratégia 2: Playwright click() com modifiers ───────────────────────
    try:
        with context.expect_page(timeout=to_pop) as popup:
            loc.click(timeout=to_click, modifiers=mods)
        new_tab = popup.value
        try:
            serp_page.bring_to_front()
        except Exception:
            pass
        return new_tab
    except Exception:
        pass

    # ── Estratégia 3: forçar target="_blank" + clique normal ─────────────────
    try:
        loc.evaluate("el => { el.target = '_blank'; el.rel = 'noopener'; }")
    except Exception:
        pass
    try:
        with context.expect_page(timeout=to_pop) as popup:
            loc.click(timeout=to_click, force=True)
        new_tab = popup.value
        try:
            serp_page.bring_to_front()
        except Exception:
            pass
        return new_tab
    except Exception:
        pass

    # ── Estratégia 4: new_page() + goto(href) — não simula Ctrl (opcional) ───
    if not AD_USE_CTRL_ONLY_OPENS:
        try:
            href_raw = loc.get_attribute("href") or ""
            target = _absolute_serp_ad_href(serp_page, href_raw)
            if target and not target.lower().startswith("javascript:"):
                p2 = context.new_page()
                try:
                    page_goto_robust(
                        p2,
                        target,
                        wait_until="commit",
                        timeout_ms=min(int(_GOOGLE_GOTO_MS), 30_000),
                    )
                except Exception:
                    try:
                        p2.close()
                    except Exception:
                        pass
                    return None
                try:
                    serp_page.bring_to_front()
                except Exception:
                    pass
                return p2
        except Exception:
            pass

    return None


def _close_accumulated_background_tabs(serp_page: Page, tabs: list[Page]) -> int:
    """Fecha separadores abertos pelo burst e devolve a foco à SERP. Retorna quantos fechou."""
    closed = 0
    for tab in tabs:
        try:
            tab.close()
            closed += 1
        except Exception:
            pass
    try:
        serp_page.bring_to_front()
    except Exception:
        pass
    return closed


def _ctrl_click_accumulate(
    context,
    serp_page: Page,
    loc: Locator,
    n: int,
) -> list[Page]:
    """
    Executa ``n`` tentativas em sequência no mesmo anúncio ``loc`` (novo separador por sucesso).

    - ``serp_page`` mantém-se no foco entre tentativas (``bring_to_front``).
    - Cada tentativa: ``_one_ctrl_click_new_tab`` (cadeia Ctrl/Cmd + fallback opcional).
    - Devolve a lista de ``Page`` abertas; o chamador fecha-as todas de seguida.
    """
    accumulated: list[Page] = []

    for rep in range(n):
        try:
            serp_page.bring_to_front()
        except Exception:
            pass

        new_tab = _one_ctrl_click_new_tab(context, serp_page, loc)

        if new_tab is not None:
            accumulated.append(new_tab)
            try:
                serp_page.bring_to_front()
            except Exception:
                pass
            print(f"    clique {rep + 1}/{n} ✓  ({len(accumulated)} aba(s) acumulada(s))")
        else:
            print(f"    clique {rep + 1}/{n} ✗  todas as estratégias falharam — ignora.")

        if rep < n - 1:
            human_sleep(
                float(AD_CTRL_CLICK_GAP_MIN),
                float(AD_CTRL_CLICK_GAP_MAX),
            )

    return accumulated


def main() -> None:
    # Modo pesquisador/notificador: uma sessão por ciclo completo de queries.txt.
    # Abre o navegador, pesquisa todas as keywords, fecha, aguarda 16s e reinicia.
    restart_each_round = True
    browser = None
    try:
        with sync_playwright() as p:
            captcha_solver = build_captcha_solver()
            if captcha_solver:
                bal = captcha_solver.get_balance()
                if bal is not None:
                    print(f"[2captcha] Cliente activo (saldo: {bal}).")
                else:
                    print("[2captcha] Cliente activo (chave definida).")

            keywords = load_search_keywords()

            wl = get_whitelist_patterns_cached(WHITELIST_FILE)
            if wl:
                print(
                    f"[whitelist] {len(wl)} regra(s) em {WHITELIST_FILE!r} — "
                    "anúncios com substring em URL/cite/título são ignorados."
                )

            rounds = get_search_rounds()
            total = len(keywords)
            if restart_each_round:
                print(
                    f"\nModo: reinício por rodada (start/stop API). Cookies não são limpos pelo script "
                    f"(perfil AdsPower mantém storage). {rounds} rodada(s) × {total} consulta(s).\n"
                )
            else:
                print(
                    f"\nModo: sessão única até ao fim. Entre rodadas: ROUND_CLEANUP_MODE={ROUND_CLEANUP_MODE!r}. "
                    f"{rounds} rodada(s) × {total} consulta(s).\n"
                )

            grand_ok = 0
            for round_idx in range(1, rounds + 1):
                if restart_each_round or round_idx == 1:
                    ws_endpoint = start_profile()
                    print_profile_ip_from_adspower_api(round_idx=round_idx, rounds=rounds)
                    browser, page = _playwright_connect_pick_page(p, ws_endpoint)

                print(f"\n{'='*20} RODADA {round_idx}/{rounds} {'='*20}")
                ok_round = 0
                for i, keyword in enumerate(keywords, start=1):
                    print(f"\n=== [R{round_idx}/{rounds} · {i}/{total}] {keyword!r} ===")
                    try:
                        do_google_search(page, keyword, captcha_solver=captcha_solver)

                        sent_ok = inspect_and_notify_ad_slots_blocking(page, keyword, [])
                        if not sent_ok:
                            print(
                                "  Aviso: inspeção concluída, mas um ou mais envios ao Telegram falharam."
                            )
                            continue
                        print("  OK — pesquisa concluída e inspeção Telegram executada (sem cliques).")
                        ok_round += 1
                        grand_ok += 1
                    except PlaywrightTimeoutError as e:
                        print(f"  Timeout: {e}")
                    except Exception as e:
                        print(f"  Erro: {e}")

                print(
                    f"\nRodada {round_idx}/{rounds}: {ok_round}/{total} consulta(s) processada(s) sem clique."
                )

                if restart_each_round:
                    try:
                        if browser:
                            browser.close()
                    except Exception:
                        pass
                    browser = None
                    stop_profile()
                    if round_idx < rounds:
                        print(
                            "[rodada] Browser fechado (API stop); próxima rodada fará novo start "
                            f"(pausa {PAUSE_BETWEEN_ROUNDS_MIN:.0f}s)."
                        )
                        human_sleep(PAUSE_BETWEEN_ROUNDS_MIN, PAUSE_BETWEEN_ROUNDS_MAX)
                elif round_idx < rounds:
                    clear_browser_for_new_round(page)
                    _rc = (ROUND_CLEANUP_MODE or "full").strip().lower()
                    if _rc in ("none", "tabs_only"):
                        print(
                            f"[rodada] ROUND_CLEANUP_MODE={_rc!r}: só separadores extra; "
                            "cookies não limpos. Pausa antes da próxima rodada."
                        )
                    else:
                        print(
                            "[rodada] ROUND_CLEANUP_MODE=full: cookies, cache HTTP e storage limpos. "
                            "Pausa antes da próxima rodada."
                        )
                    human_sleep(PAUSE_BETWEEN_ROUNDS_MIN, PAUSE_BETWEEN_ROUNDS_MAX)

            if not restart_each_round:
                try:
                    if browser:
                        browser.close()
                except Exception:
                    pass
                browser = None
                stop_profile()

            print(
                f"\nResumo global: {grand_ok}/{total * rounds} consultas processadas sem clique "
                f"({rounds} rodada(s) × {total} consulta(s))."
            )

    except PlaywrightTimeoutError as e:
        print(f"Tempo excedido durante a navegação: {e}")
    except Exception as e:
        print(f"Erro: {e}")
    finally:
        try:
            if browser:
                browser.close()
        except Exception:
            pass
        stop_profile()


if __name__ == "__main__":
    main()
