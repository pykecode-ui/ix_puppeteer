from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
import requests
import time
import logging
import traceback
import os
from mysql2 import ConexaoMySQL
from datetime import datetime
import signal
import sys
import requests
import json
import pytz


# Configuração de logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

def checar_status():
    try:
        with open('controle.txt', 'r') as f:
            status = f.read().strip()
        return status.upper() == 'ON'
    except Exception:
        return True  # Se não existir, continua rodando

def checar_headless():
    try:
        with open('headless.txt', 'r') as f:
            status = f.read().strip()
        return status.upper() == 'ON'
    except Exception:
        return False  # Se não existir, padrão é não headless

def checar_printscreen():
    try:
        with open('printscreen.txt', 'r') as f:
            status = f.read().strip()
        return status.upper() == 'ON'
    except Exception:
        return False  # Se não existir, padrão é não tirar print

VPS_IP = ""
BLACKLIST = []
SAFELIST = []
TIME_MENSSAGEM_TELEGRAM_EM_SEGUNDOS = 3 * 60

DB_HOST = "54.39.139.40"
DB_USER = "botv3"
DB_PASS = "botv3"
DB_NAME = "botv3"
TAMANHO_BATCH = 8  # Defina o tamanho do batch aqui
TEMPO_ESPERA = 2  # Tempo de espera em segundos entre as operações

def criar_opcoes_webdriver():
    """
    Cria e retorna opções para o WebDriver do Chrome.
    Define o tamanho da janela e pode ser configurado para rodar em modo headless.
    """
    opcoes = Options()
    opcoes.add_argument("--window-size=1024,800")
    opcoes.add_argument("--disable-blink-features=AutomationControlled")  # Remove a mensagem de automação
    opcoes.add_argument("user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36")  # Define um user-agent mais atual
    if checar_headless():  # VERIFICA O MODO HEADLESS SEMPRE QUE CHAMA
        opcoes.add_argument("--headless")  # Executa o navegador em modo headless
    opcoes.add_experimental_option("excludeSwitches", ["enable-automation"])
    opcoes.add_experimental_option('useAutomationExtension', False)
    return opcoes

def inicializar_navegador():
    """
    Inicializa o navegador com as opções configuradas e remove a propriedade webdriver.
    """
    navegador = webdriver.Chrome(options=criar_opcoes_webdriver())
    navegador.execute_cdp_cmd('Page.addScriptToEvaluateOnNewDocument', {
        'source': '''
            Object.defineProperty(navigator, 'webdriver', {
                get: () => undefined
            })
        '''
    })
    return navegador

def enviar_telegram_all(mensagem):
    """
    Envia uma mensagem para um chat do Telegram usando a API do Telegram.
    """
    token = '6556150200:AAEZOJRaqq-ax6OZEjCXzSIR89Ib4POuhoo'
    chat_id = '-1002039113511'
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    data = {'chat_id': chat_id, 'text': mensagem}
    
    try:
        response = requests.post(url, data=data)
        if response.status_code == 200:
            logging.info("Mensagem enviada com sucesso para o Telegram.")
        else:
            logging.error(f"Falha ao enviar mensagem, status code: {response.status_code}, resposta: {response.text}")
    except requests.exceptions.RequestException as e:
        logging.error(f"Erro ao tentar enviar mensagem para o Telegram: {e}")

def telegram_ads_alert(mensagem):
    """
    Envia uma mensagem para um chat do Telegram usando a API do Telegram.
    """
    token = '6970824023:AAHrF6xeYcIr7B1OrSW-MIljquamiwt8dYQ'
    chat_id = '-1002007988927'
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    data = {'chat_id': chat_id, 'text': mensagem}
    
    try:
        response = requests.post(url, data=data)
        if response.status_code == 200:
            logging.info("Mensagem enviada com sucesso para o Telegram.")
        else:
            logging.error(f"Falha ao enviar mensagem, status code: {response.status_code}, resposta: {response.text}")
    except requests.exceptions.RequestException as e:
        logging.error(f"Erro ao tentar enviar mensagem para o Telegram: {e}")

def telegram_ads_fake(mensagem):
    """
    Envia uma mensagem para um chat do Telegram usando a API do Telegram.
    """
    token = '6452716431:AAHtI2Y91RHM0L5ezdTqyWu6iCXe_bGwvFg'
    chat_id = '-1002076405419'
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    data = {'chat_id': chat_id, 'text': mensagem}
    
    try:
        response = requests.post(url, data=data)
        if response.status_code == 200:
            logging.info("Mensagem enviada com sucesso para o Telegram.")
        else:
            logging.error(f"Falha ao enviar mensagem, status code: {response.status_code}, resposta: {response.text}")
    except requests.exceptions.RequestException as e:
        logging.error(f"Erro ao tentar enviar mensagem para o Telegram: {e}")


def aceitar_cookies(navegador):
    """
    Tenta encontrar e clicar no botão de aceitar cookies em uma página web.
    """
    try:
        botao_aceitar = navegador.find_element(By.XPATH, '//*[@id="L2AGLb"]/div')
        botao_aceitar.click()
        time.sleep(TEMPO_ESPERA)
    except Exception:
        logging.info("Botão de cookies não encontrado ou erro ao tentar aceitar cookies.")

def verificar_posicao_anuncios(anuncios, palavra_chave, slot):
    """
    Verifica a posição de cada anúncio na lista de resultados e retorna uma lista
    de dicionários com o texto do anúncio, sua posição e o slot.
    """
    posicoes_anuncios = []
    for i, anuncio in enumerate(anuncios):
        texto_anuncio = anuncio.text
        if palavra_chave.lower() in texto_anuncio.lower():
            posicoes_anuncios.append({
                'texto': texto_anuncio,
                'posicao': i + 1,  # Posição do anúncio (começando de 1)
                'slot': slot
            })
    return posicoes_anuncios

def buscar_anuncio(navegador, palavra_chave):
    """
    Realiza uma busca no Google por uma palavra-chave e captura anúncios que correspondem.
    Salva capturas de tela dos anúncios e envia informações para o Telegram.
    """
    try:
        navegador.get("https://www.google.com")
        aceitar_cookies(navegador)

        caixa_busca = navegador.find_element(By.NAME, "q")
        caixa_busca.send_keys(palavra_chave + Keys.RETURN)
        time.sleep(TEMPO_ESPERA)
        
        aceitar_cookies(navegador)

        # Identificar e processar anúncios em diferentes slots e posições
        anuncios_capturados = []

        slots_xpaths = {
            '0-1': '//div[@data-ta-slot="0" and @data-ta-slot-pos="1" and @data-text-ad="1"]',
            '0-2': '//div[@data-ta-slot="0" and @data-ta-slot-pos="2" and @data-text-ad="1"]',
            '3-1': '//div[@data-ta-slot="3" and @data-ta-slot-pos="1" and @data-text-ad="1"]'
        }

        for slot, xpath in slots_xpaths.items():
            slot_num, pos_num = slot.split('-')
            anuncios = navegador.find_elements(By.XPATH, xpath)
            
            if anuncios:
                posicoes = verificar_posicao_anuncios(anuncios, palavra_chave, slot_num)
                for i, anuncio in enumerate(anuncios):
                    texto_anuncio = anuncio.text
                    # Captura de tela do anúncio
                    
                    data_pcu = ""
                    link = ""
                    # Obtenção do link de exibição
                    try:
                        link_element = anuncio.find_element(By.XPATH, './/a')
                        link = link_element.get_attribute('data-rw')
                    except Exception:
                        link = "Link não encontrado"

                    # Obtenção do atributo data-pcu
                    try:
                        data_pcu = link_element.get_attribute('data-pcu')
                        print(f"Data PCU: {data_pcu}")
                    except Exception:
                        print("Atributo data-pcu não encontrado")

                    conexao = ConexaoMySQL(
                        host=DB_HOST,
                        user=DB_USER,
                        password=DB_PASS,
                        database=DB_NAME
                    )

                    is_blacklist = "N"
                    enviar_telegram = True
                    for blacklist in BLACKLIST:
                        if data_pcu.find(blacklist) != -1:
                            is_blacklist = "S"
                            break
                    
                    is_safelist = "N"
                    for safelist in SAFELIST:
                        if data_pcu == safelist:
                            is_safelist = "S"
                            break
                    
                    if not VPS_IP:
                        consultar_ip_info()  # Supondo que esta função define o valor de VPS

                    last_telegram = conexao.select(f"SELECT max(last_telegram) AS last_telegram FROM ads WHERE url = '{data_pcu}' AND last_telegram is not null GROUP BY url")

                    if last_telegram != None and len(last_telegram) > 0:
                        print(last_telegram)
                        agora = datetime.now()
                        t = last_telegram[0]
                        difference = agora - t
                        difference_in_minutes = difference.total_seconds()

                        print(f"difference_in_minutes => {difference_in_minutes}")

                        if difference_in_minutes > TIME_MENSSAGEM_TELEGRAM_EM_SEGUNDOS:
                            enviar_telegram = True
                        else:
                            enviar_telegram = False

                    dados_inserir = {
                        "provedor": "GOOGLE",
                        "word": palavra_chave,
                        "url": data_pcu,
                        "url_atk": link,
                        "title": texto_anuncio,
                        "subtitle": "",
                        "is_blacklist": is_blacklist,
                        "created_at": datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
                        "is_view": "N",
                        "vps": VPS_IP
                    }
                    
                    if is_safelist == "N":
                        conexao.inserir_dados("ads", dados_inserir)
                    
                    if enviar_telegram:
                        agora = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
                        conexao.executar_query(f"UPDATE ads SET last_telegram = '{agora}' WHERE url = '{data_pcu}'")

                    conexao.fechar_conexao()

                    xpaths_titulo = [
                        './/div[contains(@class, "CCgQ5 vCa9Yd QfkTvb MUxGbd v0nnCb")]',  # Novo XPath mais genérico
                        './/span[contains(@class, "OSrXXb")]',  # XPath alternativo
                        # Adicione outros XPaths aqui se necessário
                    ]

                    titulo_anuncio = "Título não encontrado"
                    for xpath in xpaths_titulo:
                        try:
                            titulo_elemento = anuncio.find_element(By.XPATH, xpath)
                            titulo_anuncio = titulo_elemento.text
                            if titulo_anuncio:
                                break  # Se um título válido for encontrado, saia do loop
                        except Exception:
                            continue  # Tente o próximo XPath se o atual falhar                    

                    mensagem = (
                        f"Anúncio encontrado para '{palavra_chave}'\n"
                        f"Título anúncio: {titulo_anuncio}\n"
                        f"Data PCU: {data_pcu}\n"
                        f"Data RW: {link}\n"
                        f"Anúncio encontrado no slot {posicoes[i]['slot']} \n"
                        f"na posição {posicoes[i]['posicao']}\n"
                        f"VPS: {VPS_IP}"
                    )

                    if enviar_telegram:
                        enviar_telegram_all(mensagem)
                        time.sleep(3)

                    # Envio da imagem para o Telegram com as posições e informações do slot
                    #enviar_imagem_telegram(imagem_caminho, link, [posicoes[i]], "Anúncio encontrado:", palavra_chave)
                    if palavra_chave.lower() in titulo_anuncio.lower() and is_safelist == "N" and enviar_telegram:
                        telegram_ads_alert(mensagem)
                        time.sleep(3)
                        
                    if is_blacklist == "S" and is_safelist == "N" and enviar_telegram:
                        telegram_ads_fake(mensagem)

        time.sleep(TEMPO_ESPERA)
    except Exception as e:
        logging.error(f"Ocorreu um erro ao buscar anúncio para '{palavra_chave}': {e}")
        traceback.print_exc()
        return False
    return True

def buscar_anuncios(palavras_chave):
    navegador = inicializar_navegador()
    palavras_falhas = []
    try:
        palavras_procuradas = set()
        for idx, palavra_chave in enumerate(palavras_chave):
            if palavra_chave not in palavras_procuradas:
                sucesso = buscar_anuncio(navegador, palavra_chave)
                if not sucesso:
                    palavras_falhas.append(palavra_chave)
                palavras_procuradas.add(palavra_chave)
            # Tira print após a última palavra do batch
            if checar_printscreen() and idx == len(palavras_chave) - 1:
                tirar_print(navegador, "print2.png")
    finally:
        navegador.quit()
    return palavras_falhas

def ler_palavras_chave_arquivo(caminho_arquivo):
    """
    Lê um arquivo de texto e retorna uma lista de palavras-chave.
    """
    with open(caminho_arquivo, 'r', encoding='utf-8') as arquivo:
        palavras_chave = [linha.strip() for linha in arquivo.readlines()]
    return palavras_chave

def atualizar_registro_execucao_local(vps_ip):
    """
    Atualiza ou cria o arquivo registro_execucao_local.json com a data e hora atual (timezone São Paulo).
    """
    from datetime import datetime
    import pytz
    import json
    import os

    caminho_arquivo = "registro_execucao_local.json"
    tz = pytz.timezone("America/Sao_Paulo")
    agora = datetime.now(tz).strftime("%Y-%m-%d %H:%M:%S")

    dados = {
        vps_ip: {
            "data_execucao": agora,
            "vps_ip": vps_ip,
            "tipo_atualizacao": "Atualização periódica"
        }
    }

    with open(caminho_arquivo, "w", encoding="utf-8") as f:
        json.dump(dados, f, ensure_ascii=False, indent=4)

def executar_rodadas(num_rodadas, palavras_chave, tamanho_batch):
    """
    Executa múltiplas rodadas de busca de anúncios, dividindo as palavras-chave em lotes.
    Tenta novamente para palavras-chave que falharam na busca.
    """
    for i in range(num_rodadas):
        logging.info(f"Iniciando rodada {i+1} de {num_rodadas}")
        consultar_blacklist()
        consultar_safelist()
        palavras_falhas_totais = []
        for batch in dividir_em_batches(palavras_chave, tamanho_batch):
            if not checar_status():
                print("Script pausado durante o processamento do batch. Aguardando...")
                while not checar_status():
                    time.sleep(10)
                print("Script retomado! Reiniciando processamento do início.")
                return  # Sai da função para reiniciar o processo no main()
            palavras_falhas = buscar_anuncios(batch)
            palavras_falhas_totais.extend(palavras_falhas)
            atualizar_registro_execucao_local(VPS_IP)
            if palavras_falhas:
                logging.info(f"Tentando novamente para palavras falhas: {palavras_falhas}")
                palavras_falhas_retry = buscar_anuncios(palavras_falhas)
                palavras_falhas_totais.extend(palavras_falhas_retry)
        if palavras_falhas_totais:
            logging.error(f"Palavras-chave não pesquisadas após tentativas: {', '.join(set(palavras_falhas_totais))}")
        logging.info(f"Rodada {i+1} concluída.")

def dividir_em_batches(lista, tamanho_batch):
    """
    Divide uma lista em sublistas (batches) de tamanho especificado.
    """
    for i in range(0, len(lista), tamanho_batch):
        yield lista[i:i + tamanho_batch]

def signal_handler(sig, frame):
    """
    Manipulador de sinal para capturar interrupções (Ctrl+C) e encerrar o script de forma limpa.
    """
    logging.info("Interrupção recebida, encerrando o script...")
    sys.exit(0)

def consultar_ip_info():
    global VPS_IP
    try:
        # Realiza a requisição para a API ipinfo.io
        response = requests.get("https://ipinfo.io/json")

        # Verifica se a resposta foi bem-sucedida (status code 200)
        if response.status_code == 200:
            data = response.json()
            ip = data.get("ip")
            country = data.get("country")

            VPS_IP = f"{ip} - {country}"
            print(VPS_IP)
        else:
            print(f"Erro na requisição: {response.status_code}")

    except Exception as e:
        print(f"Ocorreu um erro: {e}")

def consultar_blacklist():
    global BLACKLIST
    try:
        
        conexao = ConexaoMySQL(
            host=DB_HOST,
            user=DB_USER,
            password=DB_PASS,
            database=DB_NAME
        )

        BLACKLIST = []
        blacklists = conexao.consultar_dados("black_list")

        for blacklist in blacklists:
            BLACKLIST.append(blacklist[1])

        conexao.fechar_conexao()

    except Exception as e:
        print(f"Ocorreu um erro: {e}")

def consultar_safelist():
    global SAFELIST
    try:
        
        conexao = ConexaoMySQL(
            host=DB_HOST,
            user=DB_USER,
            password=DB_PASS,
            database=DB_NAME
        )

        SAFELIST = []
        safelists = conexao.consultar_dados("safe_list")

        for safelist in safelists:
            SAFELIST.append(safelist[1])

        conexao.fechar_conexao()

    except Exception as e:
        print(f"Ocorreu um erro: {e}")

def tirar_print(navegador, nome_arquivo):
    navegador.save_screenshot(nome_arquivo)
    # Salva a data/hora de SP em um txt
    tz = pytz.timezone("America/Sao_Paulo")
    agora = datetime.now(tz).strftime("%d/%m/%Y %H:%M:%S")
    with open("print2.txt", "w", encoding="utf-8") as f:
        f.write(agora)


def main():
    """
    Função principal que executa o processo de busca de anúncios em um loop contínuo.
    Lê palavras-chave de um arquivo e executa rodadas de busca.
    """
    # Configura o manipulador de sinal para interrupções
    signal.signal(signal.SIGINT, signal_handler)
    consultar_ip_info()

    while True:
        if not checar_status():
            print("Script pausado. Aguardando...")
            time.sleep(10)  # Aguarda 10 segundos antes de checar novamente
            continue
        try:
            palavras_chave = ler_palavras_chave_arquivo("new.txt")
            num_rodadas = 1000
            executar_rodadas(num_rodadas, palavras_chave, TAMANHO_BATCH)
        except Exception as e:
            logging.error(f"Ocorreu um erro: {e}")
            traceback.print_exc()
            time.sleep(TEMPO_ESPERA)
            continue

if __name__ == "__main__":
    main()
