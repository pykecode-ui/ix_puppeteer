# 📚 ixBrowser Local API - Documentação Completa

> **Nota:** Este documento foi extraído e traduzido da documentação oficial do ixBrowser para facilitar o desenvolvimento do bot. Ele contém todos os endpoints principais para gerenciar perfis (criação, edição, fingerprint), limpeza de cache e controle do navegador.

---

## 📑 Índice

- [API Overview](#api-overview)
- [Get Profile List](#get-profile-list)
- [Create Profile](#create-profile)
- [Copy Profile](#copy-profile)
- [Open Profile](#open-profile)
- [Get Opened Profile](#get-opened-profile)
- [Retrieve profiles opened via the local API](#retrieve-profiles-opened-via-the-local-api)
- [Customize the layout for the profiles already opened](#customize-the-layout-for-the-profiles-already-opened)
- [Reset Browser Open Status](#reset-browser-open-status)
- [Open Profile  with Random Fingerprint Configuration](#open-profile-with-random-fingerprint-configuration)
- [Close Profile](#close-profile)
- [Close Profiles in Batches](#close-profiles-in-batches)
- [Clear Profile Cache](#clear-profile-cache)
- [Clear Profile Cache And Cookies](#clear-profile-cache-and-cookies)
- [Clear the saved account and password in the browser](#clear-the-saved-account-and-password-in-the-browser)
- [Update Profile](#update-profile)
- [Update Profile Proxy Information - Purchased Residential Proxy](#update-profile-proxy-information-purchased-residential-proxy)
- [Update Profile Proxy Information - Purchased Static Proxy](#update-profile-proxy-information-purchased-static-proxy)
- [Update Profile Proxy Information - Custom Proxy](#update-profile-proxy-information-custom-proxy)
- [Update Profile Proxy Information - API Extraction](#update-profile-proxy-information-api-extraction)
- [Random Fingerprint Configuration](#random-fingerprint-configuration)
- [Update Profile Groups in Batches](#update-profile-groups-in-batches)
- [Get Profile Cookies](#get-profile-cookies)
- [Update Profile Cookies](#update-profile-cookies)
- [Delete Profile](#delete-profile)
- [Empty Recycle Bin](#empty-recycle-bin)
- [Create Profile Transfer Code](#create-profile-transfer-code)
- [Cancel Profile Transfer Code](#cancel-profile-transfer-code)
- [Import Profile via Transfer Code](#import-profile-via-transfer-code)
- [Get Profile Transfer Records List](#get-profile-transfer-records-list)
- [Get Group](#get-group)
- [Create Group](#create-group)
- [Update Group](#update-group)
- [Delete Group](#delete-group)
- [Get Tag](#get-tag)
- [Create Tag](#create-tag)
- [Update Tag](#update-tag)
- [Delete Tag](#delete-tag)
- [Get the Residential Proxy List](#get-the-residential-proxy-list)
- [Get Proxy List](#get-proxy-list)
- [Create Custom Proxy](#create-custom-proxy)
- [Update Custom Proxy](#update-custom-proxy)
- [Delete Custom Proxy](#delete-custom-proxy)
- [Get Proxy Tag](#get-proxy-tag)
- [Create Proxy Tag](#create-proxy-tag)
- [Update Proxy Tag](#update-proxy-tag)
- [Delete Proxy Tag](#delete-proxy-tag)
- [Get Gateway List](#get-gateway-list)
- [Switch Access Gateway](#switch-access-gateway)
- [Appendix](#appendix)
- [Script Example](#script-example)

---

## API Overview

Our API can assist users in programmatically reading and writing account configuration information, starting and stopping browsers, querying accounts, and other basic interfaces. It can also be used with automation frameworks such as Selenium and Puppeteer to achieve browser operation automation.

**API Description**

1. Preparation before usage:
    -    Check if the logged-in account has API permissions.
    -    The default access address for the API interface is http://127.0.0.1:53200  , and the port can be customized.
    ![api_en.png](https://d.ixbrowser.com/ixbrowser/image/api/api_en.png "api_en.png")
    
    
2. Parameter Description:
    - The request method is POST.
    - POST content is in JSON format.
    - Optional parameters are not required and can be omitted.  
    
    
3. Interface Limit:
    - The number of concurrent requests to the interface is limited to 3.

**Método:** `POST`
**URL:** `undefined`

---

## Get Profile List

**Método:** `POST`
**URL:** `http://127.0.0.1:53200/api/v2/profile-list`

### Parâmetros (JSON Body)
| Chave | Obrigatório | Tipo | Descrição |
| --- | --- | --- | --- |
| `profile_id` | ❌ Não | Integer | Profile serial number |
| `name` | ❌ Não | String | Profile Name |
| `group_id` | ❌ Não | Integer | Group ID |
| `tag_id` | ❌ Não | Integer | Tag ID |
| `page` | ❌ Não | Integer | Number of pages Default: 1 |
| `limit` | ❌ Não | Integer | Number of returns per page Default: 10 |

### Exemplo de Payload
```json
{
    "profile_id": 0,
    "name": "",
    "group_id": 0,
    "tag_id": 0,
    "page": 1,
    "limit": 10
}
```

---

## Create Profile

**Método:** `POST`
**URL:** `http://127.0.0.1:53200/api/v2/profile-create`

### Parâmetros (JSON Body)
| Chave | Obrigatório | Tipo | Descrição |
| --- | --- | --- | --- |
| `site_id` | ❌ Não | Integer | Platform ID Default: 22 For details, please refer to the Enumeration Variable Appendix |
| `site_url` | ❌ Não | String | Specify the platform URL. Required when site_id is 21 |
| `color` | ❌ Não | String | Icon color of profile |
| `name` | ✅ Sim | String | Profile Name |
| `note` | ❌ Não | String | Notes |
| `group_id` | ❌ Não | Integer | Group ID The default group ID is 1 |
| `tag` | ❌ Não | String | Tag name (If there are multiple tags, please sendin array format) |
| `username` | ❌ Não | String | Platform login username |
| `password` | ❌ Não | String | Platform login password |
| `tfa_secret` | ❌ Não | String | 2FA Key |
| `cookie` | ❌ Não | String | Cookie   json Format |
| `proxy_config` | ❌ Não | Object | Proxy information configuration |
| `proxy_config.proxy_mode` | ❌ Não | Integer | Proxy Method Default: 2 For details, please refer to the Enumeration Variable Appendix |
| `proxy_config.proxy_check_line` | ❌ Não | String | Proxy Detection Line  Default:global_line proxy_mode is 2 or 4, effect when proxy_type is not direct |
| `proxy_config.proxy_id` | ❌ Não | String | Proxy ID  Required when proxy_mode is not 2 |
| `proxy_config.proxy_type` | ❌ Não | String | Proxy Type Default: direct For details, please refer to the Enumeration Variable Appendix |
| `proxy_config.proxy_ip` | ❌ Não | String | Proxy  proxy_mode is 2, required when proxy_type is not direct |
| `proxy_config.proxy_port` | ❌ Não | String | Proxy Port proxy_mode is 2, required when proxy_type is not direct |
| `proxy_config.proxy_user` | ❌ Não | String | Proxy Account |
| `proxy_config.proxy_password` | ❌ Não | String | Proxy Password |
| `proxy_config.ip_detection` | ❌ Não | String | Whether to obtain the latest IP's country, time zone, coordinates, etc. every time (not required for non-dynamic IP) 0: Off 1: On Default: 0 |
| `proxy_config.traffic_package_ip_policy` | ❌ Não | Boolean | IP Policy false: keep the IP unchanged (5~60 minutes) true: get a new IP every time you open the profile Default: false takes effect when proxy_mode is 1 |
| `proxy_config.country` | ❌ Não | String | Country For details, please refer to the Country Appendix |
| `proxy_config.city` | ❌ Não | String | City Can be queried in ixBrowser modification profilr-proxy configuration |
| `proxy_config.gateway` | ❌ Não | String | Residential Proxy default node. For details, please refer to the Enumeration Variable Appendix. |
| `proxy_config.proxy_service` | ❌ Não | String | Service provider general: general api default: effective when general proxy_mode is 4 |
| `proxy_config.proxy_data_format_type` | ❌ Não | String | Data format type Optional value: txt/json Default: txt |
| `proxy_config.proxy_data_txt_format` | ❌ Não | String | TXT data format Default: ip:port For details, please refer to the enumeration variable appendix. It takes effect when the API extraction proxy data format type is txt. |
| `proxy_config.proxy_data_json_format` | ❌ Não | Object | json data format mapping relationship |
| `proxy_config.proxy_data_json_format.ip` | ❌ Não | String | Proxy IP mapping field Default: ip |
| `proxy_config.proxy_data_json_format.port` | ❌ Não | String | Proxy IP mapping field Default: port |
| `proxy_config.proxy_data_json_format.username` | ❌ Não | String | Proxy IP mapping field Default: username |
| `proxy_config.proxy_data_json_format.password` | ❌ Não | String | Proxy IP mapping field Default: password |
| `proxy_config.proxy_extraction_method` | ❌ Não | String | Extraction method invalid: extract a new IP when the IP is invalid every_type: extract a new IP every time the profile is opened Default: effective when invalid proxy_mode is 4 |
| `proxy_config.proxy_url` | ❌ Não | String | Link extraction Required when proxy_mode is 4 |
| `proxy_config.use_system_proxy` | ❌ Não | String | Enable system proxy 1:follow global settings 2:Enable 3:Close Default：1 |
| `proxy_config.enable_bypass` | ❌ Não | String | Bypass List 0:Close 1:Open Default：0 |
| `proxy_config.bypass_list` | ❌ Não | String | The domains that do not go through the proxy, separate by newlines |
| `fingerprint_config` | ❌ Não | Object | Fingerprint Configuration |
| `fingerprint_config.hardware_concurrency` | ❌ Não | String | CPU Parameter  Default：4 |
| `fingerprint_config.device_memory` | ❌ Não | String | Memory Parameters Default：8 |
| `fingerprint_config.ua_type` | ❌ Não | Integer | System Type 1: PC 2: Mobile Phone Default: 1 |
| `fingerprint_config.platform` | ❌ Não | String | When system's ua_type is 1, it only supports Windows/Macos. When ua_type is 2, it only supports Android/IOS |
| `fingerprint_config.system_version` | ❌ Não | String | Operating system version: optional value 11/10 (valid only when platform is Windows) |
| `fingerprint_config.br_version` | ❌ Não | String | Browser Version For details, please refer to the Enumeration Variable Appendix |
| `fingerprint_config.ua_info` | ❌ Não | String | UA Details |
| `fingerprint_config.hide_debug_panel` | ❌ Não | String | Hidedebug panel 1:Open 2:Close  Default：1 （effective when ua_type is 2） |
| `fingerprint_config.kernel_version` | ❌ Não | String | Kernel version Default:0  please refer to the Enumeration Variable Appendix |
| `fingerprint_config.language_type` | ❌ Não | String | Language type 1: Generated based on access IP 2: Customized Default: 1 |
| `fingerprint_config.language` | ❌ Não | String | Language For details, please refer to the Enumeration Variable Appendix |
| `fingerprint_config.timezone_type` | ❌ Não | String | Time zone type 1: Generated based on access IP 2: Customized Default: 1 |
| `fingerprint_config.timezone` | ❌ Não | String | Time zone For details, please refer to the Enumeration Variable Appendix |
| `fingerprint_config.location` | ❌ Não | String | Geolocation type 1: Ask 2: Allow 3: Disable Default: 1 |
| `fingerprint_config.location_type` | ❌ Não | String | Whether to open geolocation 0: Customized 1: Generated based on access IP Default: 1 |
| `fingerprint_config.longitude` | ❌ Não | Number | Longitude |
| `fingerprint_config.latitude` | ❌ Não | Number | Latitude |
| `fingerprint_config.accuracy` | ❌ Não | Integer | Default Accuracy |
| `fingerprint_config.resolving_power_type` | ❌ Não | String | Resolution type 1: Follow device 2: Custom Default: 1 |
| `fingerprint_config.resolving_power` | ❌ Não | String | Resolution |
| `fingerprint_config.fonts_type` | ❌ Não | String | Font 1: System default 2: Custom Default: 1 |
| `fingerprint_config.fonts` | ❌ Não | Array | Font List Please refer to the Font Appendix for details. |
| `fingerprint_config.webrtc` | ❌ Não | String | WebRTC 1: Replace 2: True 3: Disable 4:Forward Default: 3 |
| `fingerprint_config.webgl_image` | ❌ Não | String | WebGL image 0: off 1: random Default: 1 |
| `fingerprint_config.canvas_type` | ❌ Não | String | Canvas 0: Close 1: Random Default: 1 |
| `fingerprint_config.webgl_data_type` | ❌ Não | String | WebGL Metadata 1: Random 2: Custom 3:Close Default: 1 |
| `fingerprint_config.webgl_factory` | ❌ Não | String | Vendor Please refer to the WebGL Metadata Appendix for details. |
| `fingerprint_config.webgl_info` | ❌ Não | String | Renderer Please refer to the WebGL Metadata Appendix for details. |
| `fingerprint_config.webgpu_data_type` | ❌ Não | String | WebGPU 0: Disable 1: True 2: Based on WEbGL Default: 2 |
| `fingerprint_config.audio_context` | ❌ Não | String | AudioContext 0: Close 1: Random Default: 1 |
| `fingerprint_config.media_equipment` | ❌ Não | String | Media Device 0: off 1: random Default: 1 |
| `fingerprint_config.javascript_memory_type` | ❌ Não | String | JavaScript Memory Restrictions 0:Default 1:Maximum Default:0 |
| `fingerprint_config.client_rects` | ❌ Não | String | Noise 0: Off 1: Random Default: 1 |
| `fingerprint_config.speech_voices` | ❌ Não | String | SpeechVoices 0: Off 1: Random Default: 1 |
| `fingerprint_config.device_name_source` | ❌ Não | String | Device name source 0: Each browser uses the device name of the current computer 1: Random Default: 1 |
| `fingerprint_config.device_name` | ❌ Não | String | Device name Effective when the device name source is 2 |
| `fingerprint_config.track` | ❌ Não | String | Do Not Track 0:off 1:default  2:on |
| `fingerprint_config.allow_scan_ports` | ❌ Não | String | Port Scan Protection 0: off 1: on Default: 1 |
| `fingerprint_config.allow_scan_ports_content` | ❌ Não | String | The port scan protection list uses an integer, ranging from 1 to 65535. Multiple ports are separated by commas (half-width), example: 4000,4001 |
| `fingerprint_config.cloudflare_challenge_bypassing` | ❌ Não | String | Cloudflare Verification Optimization 0: off 1: on Default: 0 |
| `preference_config` | ❌ Não | Object | Preference Settings |
| `preference_config.cookies_backup` | ❌ Não | String | Cloud backup cookie 0: Off 1: On Default: 1 |
| `preference_config.indexed_db_backup` | ❌ Não | String | Synchronize Indexed DB 0: Off 1: On Default: 0 (effective when cloud backup cookie is turned on) |
| `preference_config.local_storage_backup` | ❌ Não | String | Synchronize Local Storage 0: Off 1: On Default: 0 (effective when cloud backup cookie is turned on) |
| `preference_config.extension_data_backup` | ❌ Não | String | Synchronize extension data 0: Off 1: On Default: 0 (effective when cloud backup cookie is turned on) |
| `preference_config.extra_tab_source` | ❌ Não | String | Tag management 0: Open a specific URL each time 1: Open the tabs from the profile was last closed Default: 0 (Doesn't support opening the tabs from the profile was last closed under cloud backup cookie closed status) |
| `preference_config.open_url` | ❌ Não | String | Open the specified URL and split it by line |
| `preference_config.block_image` | ❌ Não | String | Block Image 0: Close 1: Open Default: 0 |
| `preference_config.block_audio` | ❌ Não | String | Block Audio 0: Close 1: Open Default: 0 |
| `preference_config.block_password_pages` | ❌ Não | String | Disable Password Saving Box 0: off 1: on Default: 0 |
| `preference_config.block_restore_pages` | ❌ Não | String | Prohibit restoring pages pop-up  0: Close 1: Open Default: 1 |
| `preference_config.block_notification_pages` | ❌ Não | String | Disable notification pop-up 0: Close 1: Open Default: 1 |
| `preference_config.block_popup_blocking` | ❌ Não | String | Disable Pop-up Interception  0: Close 1: Open Default: 1 |
| `preference_config.load_profile_info_page` | ❌ Não | String | Load profile information page 0: Close 1: Open Default: 1 |
| `preference_config.show_proxy_ip` | ❌ Não | String | Display Proxy IP in Address Bar 0: Close 1: Open Default: 1 |
| `preference_config.show_profile_name` | ❌ Não | String | Display Profile Name in Address Bar 0: Close 1: Open Default: 1 |
| `preference_config.show_password` | ❌ Não | String | Show Password  0: Close 1: Open Default: 0 |
| `preference_config.load_bookmarks` | ❌ Não | String | Load Imported Bookmarks  0: Close 1: Open Default: 0 |
| `preference_config.show_bookmarks_bar` | ❌ Não | String | Show Bookmarks Bar 0: off 1: on Default: 0 |
| `preference_config.auto_upload_bookmarks` | ❌ Não | String | Auto-Upload Bookmarks 0: off 1: on |

### Exemplo de Payload
```json
{
	"site_id": 21,
	"site_url": "http://baidu.com/",
	"color": "#CC9966",
	"name": "goosley",
	"note": "",
	"group_id": 1,
	"tag": "",
	"username": "",
	"password": "",
	"tfa_secret": "",
	"cookie": "",
	"proxy_config": {
		"proxy_mode": 2,
		"proxy_check_line": "global_line",
		"proxy_id": "",
		"proxy_type": "direct",
		"proxy_ip": "",
		"proxy_port": "",
		"proxy_user": "",
		"proxy_password": "",
		"ip_detection": "0",
		"traffic_package_ip_policy": false,
		"country": "us",
		"city": "",
		"gateway": "Default",
		"proxy_service": "general",
		"proxy_data_format_type": "txt",
		"proxy_data_txt_format": "ip:port",
		"proxy_data_json_format": {
			"ip": "ip",
			"port": "port",
			"username": "username",
			"password": "password"
		},
		"proxy_extraction_method": "invalid",
		"proxy_url": "",
		"use_system_proxy": "1",
		"enable_bypass": "0",
		"bypass_list": "*.example1.com\nwww.example2.com"
	},
	"fingerprint_config": {
		"hardware_concurrency": "4",
		"device_memory": "8",
		"ua_type": 1,
		"platform": "Windows",
		"system_version": "11",
		"br_version": "",
		"ua_info": "Mozilla/5.0 (Windows NT 6.2; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/104.0.0.0 Safari/537.36",
		"hide_debug_panel": "1",
		"kernel_version": "0",
		"language_type": "1",
		"language": "cn",
		"timezone_type": "1",
		"timezone": "Asia/Shanghai",
		"location": "1",
		"location_type": "1",
		"longitude": 25.7247,
		"latitude": 119.3712,
		"accuracy": 1000,
		"resolving_power_type": "1",
		"resolving_power": "1920,1080",
		"fonts_type": "1",
		"fonts": [],
		"webrtc": "3",
		"webgl_image": "1",
		"canvas_type": "1",
		"webgl_data_type": "1",
		"webgl_factory": "Google Inc.",
		"webgl_info": "ANGLE (AMD, ATI Radeon HD 4200 Direct3D9Ex vs_3_0 ps_3_0, atiumd64.dll-8.14.10.678)",
		"webgpu_data_type": "2",
		"audio_context": "1",
		"media_equipment": "1",
		"javascript_memory_type": "0",
		"client_rects": "1",
		"speech_voices": "1",
		"device_name_source": "1",
		"device_name": "",
		"track": "1",
		"allow_scan_ports": "1",
		"allow_scan_ports_content": "",
		"cloudflare_challenge_bypassing": "0"
	},
	"preference_config": {
		"cookies_backup": "1",
		"indexed_db_backup": "0",
		"local_storage_backup": "0",
		"extension_data_backup": "0",
		"extra_tab_source": "0",
		"open_url": "gitee.com\t\nwww.baidu.com",
		"block_image": "0",
		"block_audio": "0",
		"block_password_pages": "0",
		"block_restore_pages": "1",
		"block_notification_pages": "1",
		"block_popup_blocking": "1",
		"load_profile_info_page": "1",
		"show_proxy_ip": "1",
		"show_profile_name": "1",
		"show_password": "0",
		"load_bookmarks": "0",
		"show_bookmarks_bar": "0",
		"auto_upload_bookmarks": "0"
	}
}
```

---

## Copy Profile

**Método:** `POST`
**URL:** `http://127.0.0.1:53200/api/v2/profile-copy`

### Parâmetros (JSON Body)
| Chave | Obrigatório | Tipo | Descrição |
| --- | --- | --- | --- |
| `profile_id` | ✅ Sim | Integer | Profile serial number |
| `site_id` | ❌ Não | Integer | Platform ID  For details, please refer to the Enumeration Variable Appendix |
| `site_url` | ❌ Não | String | Specify the platform URL. Required when site_id is 21 |
| `name` | ❌ Não | String | Profile Name |
| `group_id` | ❌ Não | Integer | Group ID The default group ID is 1 |

### Exemplo de Payload
```json
{
	"profile_id": 1640,
	"site_id": 11,
	"site_url": "http://baidu.com/",
	"name": "new_name",
	"group_id": 177
}
```

---

## Open Profile

**Método:** `POST`
**URL:** `http://127.0.0.1:53200/api/v2/profile-open`

### Parâmetros (JSON Body)
| Chave | Obrigatório | Tipo | Descrição |
| --- | --- | --- | --- |
| `profile_id` | ✅ Sim | Integer | Profile serial number |
| `args` | ❌ Não | Array | Enable parameters. Example "args": ["--disable-extensions", "--blink-settings=imagesEnabled=false" ] For more parameters, please refer to: https://peter.sh/experiments/chromium-command-line-switches（ You can try to use more parameters, but there is no guarantee that they will all work) |
| `load_extensions` | ❌ Não | Boolean | Whether to enable the extension |
| `load_profile_info_page` | ❌ Não | Boolean | Whether to load the profile information page |
| `cookies_backup` | ❌ Não | Boolean | Cloud backup cookie false: off true: on |
| `cookie` | ❌ Não | String | cookie  json Format |

### Exemplo de Payload
```json
{
    "profile_id": 1557,
    "args": [
        "--disable-extension-welcome-page"
    ],
    "load_extensions": true,
    "load_profile_info_page": true,
    "cookies_backup": true,
    "cookie": ""
}
```

---

## Get Opened Profile

**Método:** `POST`
**URL:** `http://127.0.0.1:53200/api/v2/profile-opened-list`

---

## Retrieve profiles opened via the local API

**Método:** `POST`
**URL:** `http://127.0.0.1:53200/api/v2/native-client-profile-opened-list`

### Parâmetros (JSON Body)
| Chave | Obrigatório | Tipo | Descrição |
| --- | --- | --- | --- |
| `profile_id` | ✅ Sim | Integer | Profile serial number |
| `args` | ❌ Não | Array | Enable parameters. Example "args": ["--disable-extensions", "--blink-settings=imagesEnabled=false" ] For more parameters, please refer to: https://peter.sh/experiments/chromium-command-line-switches（ You can try to use more parameters, but there is no guarantee that they will all work) |
| `load_extensions` | ❌ Não | Boolean | Whether to enable the extension |
| `load_profile_info_page` | ❌ Não | Boolean | Whether to load the profile information page |
| `cookies_backup` | ❌ Não | Boolean | Cloud backup cookie false: off true: on |
| `cookie` | ❌ Não | String | cookie  json Format |

---

## Customize the layout for the profiles already opened

**Método:** `POST`
**URL:** `http://127.0.0.1:53200/api/v2/profile-opened-list-arrange-tile`

### Parâmetros (JSON Body)
| Chave | Obrigatório | Tipo | Descrição |
| --- | --- | --- | --- |
| `screen` | ❌ Não | Integer | Monitor 0: Primary Screen 1: Extended Screen 1 2: Extended Screen 2 ... Default: 0 |
| `layout` | ❌ Não | Integer | Layout 1: Grid 2: Overlapped Default: 1 |
| `adaptive` | ❌ Não | Integer | Auto-arrange profiles based on monitor resolution 1: Enable 0: Disable Default: 1 |
| `starting_position_x` | ❌ Não | Integer | Profile Horizontal Starting Position Default: 10 (Effective when adaptive is 0) |
| `starting_position_y` | ❌ Não | Integer | Profile Vertical Starting Position Default: 10 (Effective when adaptive is 0) |
| `profile_size_width` | ❌ Não | Integer | Profile Width Default: 500 (Effective when adaptive is 0) |
| `profile_size_hight` | ❌ Não | Integer | Profile Height Default: 500 (Effective when adaptive is 0) |
| `profile_spacing_horizontal` | ❌ Não | Integer | Profile Horizontal Spacing Default: 10 (Effective when adaptive is 0 and layout is 1) |
| `profile_spacing_vertical` | ❌ Não | Integer | Profile Vertical Spacing Default: 10 (Effective when adaptive is 0 and layout is 1) |
| `profile_deviaton_x` | ❌ Não | Integer | Profile Horizontal Offset Default: 50 (Effective when adaptive is 0 and layout is 2) |
| `profile_deviaton_y` | ❌ Não | Integer | Profile Vertical Offset Default: 50 (Effective when adaptive is 0 and layout is 2) |
| `per_line_number_of_profiles` | ❌ Não | Integer | Number of Profiles per Row Default: 3 (Effective when adaptive is 0 and layout is 1) |
| `` | ✅ Sim | String |  |

### Exemplo de Payload
```json
{
	"screen": 0,
	"layout": 1,
	"adaptive": 1,
	"starting_position_x": 10,
	"starting_position_y": 10,
	"profile_size_width": 500,
	"profile_size_hight": 500,
	"profile_spacing_horizontal": 10,
	"profile_spacing_vertical": 10,
	"profile_deviaton_x": 50,
	"profile_deviaton_y": 50,
	"per_line_number_of_profiles": 3
}
```

---

## Reset Browser Open Status

**Método:** `POST`
**URL:** `http://127.0.0.1:53200/api/v2/profile-open-state-reset`

### Parâmetros (JSON Body)
| Chave | Obrigatório | Tipo | Descrição |
| --- | --- | --- | --- |
| `profile_id` | ✅ Sim | Integer | Profile serial number |

### Exemplo de Payload
```json
{
	"profile_id": 11971
}
```

---

## Open Profile  with Random Fingerprint Configuration

The profile opened by this interface will not back up cookies

**Método:** `POST`
**URL:** `http://127.0.0.1:53200/api/v2/profile-open-with-random-fingerprint`

### Parâmetros (JSON Body)
| Chave | Obrigatório | Tipo | Descrição |
| --- | --- | --- | --- |
| `profile_id` | ✅ Sim | Integer | Profile serial number |
| `args` | ❌ Não | Array | Enable parameters. Example "args": ["--disable-extensions", "--blink-settings=imagesEnabled=false" ] For more parameters, please refer to: https://peter.sh/experiments/chromium-command-line-switches（ You can try to use more parameters, but there is no guarantee that they will all work) |
| `load_profile_info_page` | ❌ Não | Boolean | Whether to load the profile information page |
| `cookie` | ❌ Não | String | cookie  json Format |
| `proxy_config` | ❌ Não | Object | Proxy Information |
| `proxy_config.proxy_mode` | ✅ Sim | String | Proxy Method For details, please refer to the Enumeration Variable Appendix. |
| `proxy_config.proxy_check_line` | ❌ Não | String |  |
| `proxy_config.proxy_id` | ❌ Não | Integer | Proxy ID Required when proxy_mode is not 2 |
| `proxy_config.country` | ❌ Não | String | Country Enabled when proxy_mode=1, please refer to the National Appendix for details |
| `proxy_config.city` | ❌ Não | String | City Enabled when proxy_mode=1, which can be queried in the ixBrowser modification profile - proxy configuration. |
| `proxy_config.gateway` | ❌ Não | String | Residential Proxy Enabled when proxy_mode=1, for details, please refer to the Enumeration Variable Appendix. |
| `proxy_config.proxy_type` | ❌ Não | String | Proxy Method Required when proxy_mode=2, for details, please refer to the Enumeration Variable Appendix. |
| `proxy_config.proxy_ip` | ❌ Não | String | Proxy IP  proxy_mode is 2, required when proxy_type is not direct |
| `proxy_config.proxy_port` | ❌ Não | String | Proxy Port proxy_mode is 2, required when proxy_type is not direct |
| `proxy_config.proxy_user` | ❌ Não | String | Proxy Account |
| `proxy_config.proxy_password` | ❌ Não | String | Proxy Password |
| `proxy_config.proxy_service` | ❌ Não | String | Service provider general: general api default: effective when general proxy_mode is 4 |
| `proxy_config.proxy_data_format_type` | ❌ Não | String | Data format type Optional value: txt/json |
| `proxy_config.proxy_data_txt_format` | ❌ Não | String | TXT data format Default: ip:port For details, please refer to the enumeration variable appendix. It takes effect when the API extraction proxy data format type is txt. |
| `proxy_config.proxy_data_json_format` | ❌ Não | Object | json data format mapping relationship |
| `proxy_config.proxy_data_json_format.ip` | ❌ Não | String | Proxy IP mapping field Default: ip |
| `proxy_config.proxy_data_json_format.port` | ❌ Não | String | Proxy Port mapping field Default: port |
| `proxy_config.proxy_data_json_format.username` | ❌ Não | String | Proxy Username mapping field Default: username |
| `proxy_config.proxy_data_json_format.password` | ❌ Não | String | Proxy Password mapping field Default: password |
| `proxy_config.proxy_url` | ❌ Não | String | Link extraction Required when proxy_mode is 4 |
| `proxy_config.use_system_proxy` | ❌ Não | String | Enable system proxy 1:follow global settings 2:Enable 3:Close |
| `proxy_config.enable_bypass` | ❌ Não | String | Bypass List 0:Close 1:Open Default：0 |
| `proxy_config.bypass_list` | ❌ Não | String | The domains that do not go through the proxy, separate by newlines |
| `fingerprint_config` | ❌ Não | Object | Fingerprint Configuration |
| `fingerprint_config.hardware_concurrency` | ❌ Não | String | CPU Parameter |
| `fingerprint_config.device_memory` | ❌ Não | String | Memory Parameters |
| `fingerprint_config.ua_type` | ❌ Não | Integer | System Type 1: PC 2: Mobile Phone |
| `fingerprint_config.platform` | ❌ Não | String | When system's ua_type is 1, it only supports Windows/Macos. When ua_type is 2, it only supports Android/IOS |
| `fingerprint_config.system_version` | ❌ Não | String | Operating system version: optional value 11/10 (valid only when platform is Windows) |
| `fingerprint_config.br_version` | ❌ Não | String | Browser Version For details, please refer to the Enumeration Variable Appendix |
| `fingerprint_config.ua_info` | ❌ Não | String | UA Details |
| `fingerprint_config.hide_debug_panel` | ❌ Não | String | Hidedebug panel 1:Open 2:Close (effective when ua_type is 2) |
| `fingerprint_config.kernel_version` | ❌ Não | String | Kernel version 0: automatch 102:102 kernel 114:114 kernel 121:121kernel |
| `fingerprint_config.language_type` | ❌ Não | String | Language type 1: Generated based on access IP 2: Customized |
| `fingerprint_config.language` | ❌ Não | String | Language For details, please refer to the Enumeration Variable Appendix |
| `fingerprint_config.timezone_type` | ❌ Não | String | Time zone type 1: Generated based on access IP 2: Customized |
| `fingerprint_config.timezone` | ❌ Não | String | Time zone For details, please refer to the Enumeration Variable Appendix |
| `fingerprint_config.location` | ❌ Não | String | Geolocation type 1: Ask 2: Allow 3: Disable |
| `fingerprint_config.location_type` | ❌ Não | String | Whether to open geolocation 0: Customized 1: Generated based on access IP |
| `fingerprint_config.longitude` | ❌ Não | Number | Longitude |
| `fingerprint_config.latitude` | ❌ Não | Number | Latitude |
| `fingerprint_config.accuracy` | ❌ Não | Integer | Default Accuracy |
| `fingerprint_config.resolving_power_type` | ❌ Não | String | Resolution type 1: Follow device 2: Custom Default: 1 |
| `fingerprint_config.resolving_power` | ❌ Não | String | Resolution |
| `fingerprint_config.fonts_type` | ❌ Não | String | Font 1: System default 2: Custom Default: 1 |
| `fingerprint_config.fonts` | ❌ Não | Array | Font List Please refer to the Font Appendix for details. |
| `fingerprint_config.webrtc` | ❌ Não | String | WebRTC 1: Replace 2: True 3: Disable 4:Forward |
| `fingerprint_config.webgl_image` | ❌ Não | String | WebGL image 0: off 1: random |
| `fingerprint_config.canvas_type` | ❌ Não | String | Canvas 0: Close 1: Random |
| `fingerprint_config.webgl_data_type` | ❌ Não | String | WebGL Metadata 1: Random 2: Custom 3:Close |
| `fingerprint_config.webgl_factory` | ❌ Não | String | Vendor Please refer to the WebGL Metadata Appendix for details. |
| `fingerprint_config.webgl_info` | ❌ Não | String | Renderer Please refer to the WebGL Metadata Appendix for details. |
| `fingerprint_config.webgpu_data_type` | ❌ Não | String | WebGPU 0: Disable 1: True 2: Based on WEbGL |
| `fingerprint_config.audio_context` | ❌ Não | String | AudioContext 0: Close 1: Random |
| `fingerprint_config.media_equipment` | ❌ Não | String | Media Device 0: off 1: random |
| `fingerprint_config.javascript_memory_type` | ❌ Não | String | JavaScript Memory Restrictions 0:Default 1:Maximum |
| `fingerprint_config.client_rects` | ❌ Não | String | Noise 0: Off 1: Random |
| `fingerprint_config.speech_voices` | ❌ Não | String | SpeechVoices 0: Off 1: Random |
| `fingerprint_config.device_name_source` | ❌ Não | String | Device name source 0: Each browser uses the device name of the current computer 1: Random |
| `fingerprint_config.track` | ❌ Não | String | Do Not Track 0:off 1:default 2:on |
| `fingerprint_config.allow_scan_ports` | ❌ Não | String | Port Scan Protection 0: off 1: on |
| `fingerprint_config.allow_scan_ports_content` | ❌ Não | String | The port scan protection list uses an integer, ranging from 1 to 65535. Multiple ports are separated by commas (half-width), example: 4000,4001 |
| `fingerprint_config.cloudflare_challenge_bypassing` | ❌ Não | String | Cloudflare Verification Optimization 0: off 1: on |
| `preference_config` | ❌ Não | Object | Preference Settings |
| `preference_config.block_image` | ❌ Não | String | Block Image 0: Close 1: Open |
| `preference_config.block_audio` | ❌ Não | String | Block Audio 0: Close 1: Open |
| `preference_config.block_password_pages` | ❌ Não | String | Disable Password Saving Box 0: off 1: on |
| `preference_config.block_restore_pages` | ❌ Não | String | Prohibit restoring pages pop-up  0: Close 1: Open |
| `preference_config.block_notification_pages` | ❌ Não | String | Disable notification pop-up 0: Close 1: Open Default: 1 |
| `preference_config.block_popup_blocking` | ❌ Não | String | Disable Pop-up Interception  0: Close 1: Open |
| `preference_config.show_password` | ❌ Não | String | Show Password  0: Close 1: Open |
| `preference_config.load_bookmarks` | ❌ Não | String | Load Imported Bookmarks  0: Close 1: Open |
| `preference_config.show_bookmarks_bar` | ❌ Não | String | Show Bookmarks Bar 0: off 1: on |
| `preference_config.auto_upload_bookmarks` | ❌ Não | String | Auto-Upload Bookmarks 0: off 1: on |

### Exemplo de Payload
```json
{
	"profile_id": 1576,
	"args": [
		"--disable-extension-welcome-page"
	],
	"load_profile_info_page": true,
	"cookie": "",
	"proxy_config": {
		"proxy_mode": "2",
		"proxy_check_line": "global_line",
		"proxy_id": 6,
		"country": "US",
		"city": "",
		"gateway": "Default",
		"proxy_type": "socks5",
		"proxy_ip": "127.156.1.31",
		"proxy_port": "1234",
		"proxy_user": "",
		"proxy_password": "",
		"proxy_service": "general",
		"proxy_data_format_type": "txt",
		"proxy_data_txt_format": "ip:port",
		"proxy_data_json_format": {
			"ip": "ip",
			"port": "port",
			"username": "username",
			"password": "password"
		},
		"proxy_url": "",
		"use_system_proxy": "1",
		"enable_bypass": "0",
		"bypass_list": ""
	},
	"fingerprint_config": {
		"hardware_concurrency": "4",
		"device_memory": "8",
		"ua_type": 1,
		"platform": "Windows",
		"system_version": "11",
		"br_version": "",
		"ua_info": "Mozilla/5.0 (Windows NT 6.2; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/104.0.0.0 Safari/537.36",
		"hide_debug_panel": "1",
		"kernel_version": "0",
		"language_type": "1",
		"language": "cn",
		"timezone_type": "1",
		"timezone": "Asia/Shanghai",
		"location": "1",
		"location_type": "1",
		"longitude": 25.7247,
		"latitude": 119.3712,
		"accuracy": 1000,
		"resolving_power_type": "1",
		"resolving_power": "1920,1080",
		"fonts_type": "1",
		"fonts": [],
		"webrtc": "3",
		"webgl_image": "1",
		"canvas_type": "1",
		"webgl_data_type": "1",
		"webgl_factory": "",
		"webgl_info": "ANGLE (AMD, ATI Radeon HD 4200 Direct3D9Ex vs_3_0 ps_3_0, atiumd64.dll-8.14.10.678)",
		"webgpu_data_type": "2",
		"audio_context": "1",
		"media_equipment": "1",
		"javascript_memory_type": "0",
		"client_rects": "1",
		"speech_voices": "1",
		"device_name_source": "1",
		"track": "1",
		"allow_scan_ports": "0",
		"allow_scan_ports_content": "",
		"cloudflare_challenge_bypassing": "0"
	},
	"preference_config": {
		"block_image": "0",
		"block_audio": "0",
		"block_password_pages": "0",
		"block_restore_pages": "1",
		"block_notification_pages": "1",
		"block_popup_blocking": "1",
		"show_password": "0",
		"load_bookmarks": "0",
		"show_bookmarks_bar": "0",
		"auto_upload_bookmarks": "0"
	}
}
```

---

## Close Profile

The closed profile must be the profile opened through the API, otherwise the process cannot be found when closing.

**Método:** `POST`
**URL:** `http://127.0.0.1:53200/api/v2/profile-close`

### Parâmetros (JSON Body)
| Chave | Obrigatório | Tipo | Descrição |
| --- | --- | --- | --- |
| `profile_id` | ✅ Sim | Integer | Profile serial number |

### Exemplo de Payload
```json
{
    "profile_id": 1442
}
```

---

## Close Profiles in Batches

**Método:** `POST`
**URL:** `http://127.0.0.1:53200/api/v2/profile-close-in-batches`

### Parâmetros (JSON Body)
| Chave | Obrigatório | Tipo | Descrição |
| --- | --- | --- | --- |
| `profile_id` | ✅ Sim | Array | Profile serial number |

### Exemplo de Payload
```json
{
    "profile_id":["161","162"]
}
```

---

## Clear Profile Cache

**Método:** `POST`
**URL:** `http://127.0.0.1:53200/api/v2/profile-clear-cache`

### Parâmetros (JSON Body)
| Chave | Obrigatório | Tipo | Descrição |
| --- | --- | --- | --- |
| `profile_id` | ✅ Sim | Array | Profile serial number |

### Exemplo de Payload
```json
{
    "profile_id": [
        1456,
        1457
    ]
}
```

---

## Clear Profile Cache And Cookies

**Método:** `POST`
**URL:** `http://127.0.0.1:53200/api/v2/profile-clear-cache-and-cookies`

### Parâmetros (JSON Body)
| Chave | Obrigatório | Tipo | Descrição |
| --- | --- | --- | --- |
| `profile_id` | ✅ Sim | Array | Profile serial number |

### Exemplo de Payload
```json
{
    "profile_id": [
        1456,
        1457
    ]
}
```

---

## Clear the saved account and password in the browser

**Método:** `POST`
**URL:** `http://127.0.0.1:53200/api/v2/profile-clear-saved-user-password`

### Parâmetros (JSON Body)
| Chave | Obrigatório | Tipo | Descrição |
| --- | --- | --- | --- |
| `profile_id` | ✅ Sim | Integer | Profile serial number |

### Exemplo de Payload
```json
{
	"profile_id": 2319
}
```

---

## Update Profile

**Método:** `POST`
**URL:** `http://127.0.0.1:53200/api/v2/profile-update`

### Parâmetros (JSON Body)
| Chave | Obrigatório | Tipo | Descrição |
| --- | --- | --- | --- |
| `profile_id` | ✅ Sim | Integer | Profile serial number |
| `new_profile_id` | ❌ Não | Integer | New profile serial number (this parameter will update the old profile serial number) |
| `site_id` | ❌ Não | Integer | Platform ID For details, please refer to the Enumeration Variable Appendix. |
| `site_url` | ❌ Não | String | Specified Platform URL |
| `color` | ❌ Não | String | Profile Color |
| `name` | ❌ Não | String | Profile Name |
| `note` | ❌ Não | String | Profile Notes |
| `group_id` | ❌ Não | Integer | Group ID |
| `tag` | ❌ Não | String | Tag name (If there are multiple tags, please sendin array format) |
| `username` | ❌ Não | String | Platform login username |
| `password` | ❌ Não | String | Platform login password |
| `tfa_secret` | ❌ Não | String | 2FA Key |
| `cookie` | ❌ Não | String | Cookie  json format |
| `proxy_config` | ❌ Não | Object | Proxy information configuration |
| `proxy_config.proxy_mode` | ❌ Não | Integer | Proxy Method  For details, please refer to the Enumeration Variable Appendix |
| `proxy_config.proxy_check_line` | ❌ Não | String | Proxy Detection Line  Default:global_line proxy_mode is 2 or 4, effect when proxy_type is not direct |
| `proxy_config.proxy_id` | ❌ Não | String | Proxy ID  Required when proxy_mode is not 2 |
| `proxy_config.proxy_type` | ❌ Não | String | Proxy Type  For details, please refer to the Enumeration Variable Appendix |
| `proxy_config.proxy_ip` | ❌ Não | String | Proxy IP proxy_mode is 2, required when proxy_type is not direct |
| `proxy_config.proxy_port` | ❌ Não | String | Proxy Port proxy_mode is 2, required when proxy_type is not direct |
| `proxy_config.proxy_user` | ❌ Não | String | Proxy Account |
| `proxy_config.proxy_password` | ❌ Não | String | Proxy Password |
| `proxy_config.ip_detection` | ❌ Não | String | Whether to obtain the latest IP's country, time zone, coordinates, etc. every time (not required for non-dynamic IP) 0: Off 1: On Default: 0 |
| `proxy_config.traffic_package_ip_policy` | ❌ Não | Boolean | IP Policy false: keep the IP unchanged (5~60 minutes) true: get a new IP every time you open the profile Default: false takes effect when proxy_mode is 1 |
| `proxy_config.country` | ✅ Sim | String | Country For details, please refer to the Country Appendix |
| `proxy_config.city` | ✅ Sim | String | City Can be queried in ixBrowser modification profilr-proxy configuration |
| `proxy_config.gateway` | ✅ Sim | String | Residential Proxy default node. For details, please refer to the Enumeration Variable Appendix. |
| `proxy_config.proxy_service` | ❌ Não | String | Service provider  general: general api It takes effect when proxy_mode is 4 |
| `proxy_config.proxy_data_format_type` | ❌ Não | String | Data format type Optional value: txt/json |
| `proxy_config.proxy_data_txt_format` | ❌ Não | String | TXT data format   For details, please refer to the enumeration variable appendix. The API extraction proxy data format type is effective when it is txt. |
| `proxy_config.proxy_data_json_format` | ❌ Não | Object | json data format mapping relationship |
| `proxy_config.proxy_data_json_format.ip` | ❌ Não | String | Proxy IP Mapping Field |
| `proxy_config.proxy_data_json_format.port` | ❌ Não | String | Proxy Port Mapping Field |
| `proxy_config.proxy_data_json_format.username` | ❌ Não | String | Proxy Account Mapping Field |
| `proxy_config.proxy_data_json_format.password` | ❌ Não | String | Proxy Password Mapping Field |
| `proxy_config.proxy_extraction_method` | ❌ Não | String | Extraction method invalid: extract a new IP when the IP expires every_type: extract a new IP every time the profile is opened, effective when proxy_mode is 4 |
| `proxy_config.proxy_url` | ❌ Não | String | Link extraction  It takes effect when proxy_mode is 4 |
| `proxy_config.use_system_proxy` | ❌ Não | String | Enable system proxy 1:follow global settings 2:Enable 3:Close |
| `proxy_config.enable_bypass` | ❌ Não | String | Bypass List 0:Close 1:Open |
| `proxy_config.bypass_list` | ❌ Não | String | The domains that do not go through the proxy, separate by newlines |
| `fingerprint_config` | ❌ Não | Object | Fingerprint Configuration |
| `fingerprint_config.hardware_concurrency` | ❌ Não | String | CPU Parameter |
| `fingerprint_config.device_memory` | ❌ Não | String | Memory Parameters |
| `fingerprint_config.ua_type` | ❌ Não | Integer | System Type 1: PC 2: Mobile Phone |
| `fingerprint_config.platform` | ❌ Não | String | When system's ua_type is 1, it only supports Windows/Macos. When ua_type is 2, it only supports Android/IOS |
| `fingerprint_config.system_version` | ✅ Sim | String | Operating system version: optional value 11/10 (valid only when platform is Windows) |
| `fingerprint_config.br_version` | ❌ Não | String | Browser Version For details, please refer to the Enumeration Variable Appendix |
| `fingerprint_config.ua_info` | ❌ Não | String | UA Details |
| `fingerprint_config.hide_debug_panel` | ❌ Não | String | Hidedebug panel 1:Open 2:Close (effective when ua_type is 2) |
| `fingerprint_config.kernel_version` | ❌ Não | String | Kernel version 0: automatch 102:102 kernel 114:114 kernel 121:121kernel |
| `fingerprint_config.language_type` | ❌ Não | String | Language type 1: Generated based on access IP 2: Customized |
| `fingerprint_config.language` | ❌ Não | String | Language For details, please refer to the Enumeration Variable Appendix |
| `fingerprint_config.timezone_type` | ❌ Não | String | Time zone type 1: Generated based on access IP 2: Customized |
| `fingerprint_config.timezone` | ❌ Não | String | Time zone For details, please refer to the Enumeration Variable Appendix |
| `fingerprint_config.location` | ❌ Não | String | Geolocation type 1: Ask 2: Allow 3: Disable |
| `fingerprint_config.location_type` | ❌ Não | String | Whether to open geolocation 0: Customized 1: Generated based on access IP |
| `fingerprint_config.longitude` | ❌ Não | Number | Longitude |
| `fingerprint_config.latitude` | ❌ Não | Number | Latitude |
| `fingerprint_config.accuracy` | ❌ Não | Integer | Default Accuracy |
| `fingerprint_config.resolving_power_type` | ❌ Não | String | Resolution type 1: Follow device 2: Custom Default: 1 |
| `fingerprint_config.resolving_power` | ❌ Não | String | Resolution |
| `fingerprint_config.fonts_type` | ❌ Não | String | Font 1: System default 2: Custom Default: 1 |
| `fingerprint_config.fonts` | ❌ Não | Array | Font List Please refer to the Font Appendix for details. |
| `fingerprint_config.webrtc` | ❌ Não | String | WebRTC 1: Replace 2: True 3: Disable 4:Forward |
| `fingerprint_config.webgl_image` | ❌ Não | String | WebGL image 0: off 1: random |
| `fingerprint_config.canvas_type` | ❌ Não | String | Canvas 0: Close 1: Random |
| `fingerprint_config.webgl_data_type` | ❌ Não | String | WebGL Metadata 1: Random 2: Custom |
| `fingerprint_config.webgl_factory` | ❌ Não | String | Vendor Please refer to the WebGL Metadata Appendix for details. |
| `fingerprint_config.webgl_info` | ❌ Não | String | Renderer Please refer to the WebGL Metadata Appendix for details. |
| `fingerprint_config.webgpu_data_type` | ❌ Não | String | WebGPU 0: Disable 1: True 2: Based on WEbGL |
| `fingerprint_config.audio_context` | ❌ Não | String | AudioContext 0: Close 1: Random |
| `fingerprint_config.media_equipment` | ❌ Não | String | Media Device 0: off 1: random |
| `fingerprint_config.javascript_memory_type` | ❌ Não | String | JavaScript Memory Restrictions 0:Default 1:Maximum |
| `fingerprint_config.client_rects` | ❌ Não | String | Noise 0: Off 1: Random |
| `fingerprint_config.speech_voices` | ❌ Não | String | SpeechVoices 0: Off 1: Random |
| `fingerprint_config.device_name_source` | ❌ Não | String | Device name source 0: Each browser uses the device name of the current computer 1: Random |
| `fingerprint_config.track` | ❌ Não | String | Do Not Track 0:off 1:default 2:on |
| `fingerprint_config.allow_scan_ports` | ❌ Não | String | Port Scan Protection 0: off 1: on |
| `fingerprint_config.allow_scan_ports_content` | ❌ Não | String | The port scan protection list uses an integer, ranging from 1 to 65535. Multiple ports are separated by commas (half-width), example: 4000,4001 |
| `fingerprint_config.cloudflare_challenge_bypassing` | ❌ Não | String | Cloudflare Verification Optimization 0: off 1: on |
| `preference_config` | ❌ Não | Object | Preference Settings |
| `preference_config.cookies_backup` | ❌ Não | String | Cloud backup cookie 0: Off 1: On |
| `preference_config.indexed_db_backup` | ❌ Não | String | Synchronize Indexed DB 0: Disable 1: Enable (valid when cloud backup cookie is enabled) |
| `preference_config.local_storage_backup` | ❌ Não | String | Synchronize Local Storage 0: Off 1: On (effective when cloud backup cookie is turned on) |
| `preference_config.extension_data_backup` | ❌ Não | String | Synchronize extension data 0: Off 1: On (effective when cloud backup cookie is turned on) |
| `preference_config.extra_tab_source` | ❌ Não | String | Tag management 0: Open a specific URL each time 1: Open the tabs from the profile was last closed Default: 0 (Doesn't support opening the tabs from the profile was last closed under cloud backup cookie closed status) |
| `preference_config.open_url` | ❌ Não | String | Open the specified URL and split it by line |
| `preference_config.block_image` | ❌ Não | String | Block Image 0: Close 1: Open Default: 0 |
| `preference_config.block_audio` | ❌ Não | String | Block Audio 0: Close 1: Open Default: 0 |
| `preference_config.block_password_pages` | ❌ Não | String | Disable Password Saving Box 0: off 1: on |
| `preference_config.block_restore_pages` | ❌ Não | String | Prohibit restoring pages pop-up  0: Close 1: Open |
| `preference_config.block_notification_pages` | ❌ Não | String | Disable notification pop-up 0: Close 1: Open |
| `preference_config.block_popup_blocking` | ❌ Não | String | Disable Pop-up Interception  0: Close 1: Open |
| `preference_config.load_profile_info_page` | ❌ Não | String | Load profile information page 0: Close 1: Open |
| `preference_config.show_proxy_ip` | ❌ Não | String | Display Proxy IP in Address Bar 0: Close 1: Open |
| `preference_config.show_profile_name` | ❌ Não | String | Display Profile Name in Address Bar  0: Close 1: Open |
| `preference_config.show_password` | ❌ Não | String | Show Password  0: Close 1: Open |
| `preference_config.load_bookmarks` | ❌ Não | String | Load Imported Bookmarks  0: Close 1: Open |
| `preference_config.show_bookmarks_bar` | ❌ Não | String | Show Bookmarks Bar 0: off 1: on |
| `preference_config.auto_upload_bookmarks` | ❌ Não | String | Auto-Upload Bookmarks 0: off 1: on |

### Exemplo de Payload
```json
{
	"profile_id": 1600,
	"new_profile_id": 1589,
	"site_id": 2,
	"site_url": "https://amazon.com",
	"color": "#CC9966",
	"name": "name1",
	"note": "",
	"group_id": 12,
	"tag": "",
	"username": "user",
	"password": "123456",
	"tfa_secret": "",
	"cookie": "",
	"proxy_config": {
		"proxy_mode": 2,
		"proxy_check_line": "global_line",
		"proxy_id": "",
		"proxy_type": "direct",
		"proxy_ip": "",
		"proxy_port": "",
		"proxy_user": "",
		"proxy_password": "",
		"ip_detection": "1",
		"traffic_package_ip_policy": false,
		"country": "us",
		"city": "",
		"gateway": "Default",
		"proxy_service": "general",
		"proxy_data_format_type": "txt",
		"proxy_data_txt_format": "ip:port",
		"proxy_data_json_format": {
			"ip": "ip",
			"port": "port",
			"username": "username",
			"password": "password"
		},
		"proxy_extraction_method": "invalid",
		"proxy_url": "",
		"use_system_proxy": "1",
		"enable_bypass": "0",
		"bypass_list": ""
	},
	"fingerprint_config": {
		"hardware_concurrency": "4",
		"device_memory": "8",
		"ua_type": 1,
		"platform": "Windows",
		"system_version": "11",
		"br_version": "",
		"ua_info": "Mozilla/5.0 (Windows NT 6.2; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/104.0.0.0 Safari/537.36",
		"hide_debug_panel": "1",
		"kernel_version": "0",
		"language_type": "1",
		"language": "cn",
		"timezone_type": "1",
		"timezone": "Asia/Shanghai",
		"location": "1",
		"location_type": "1",
		"longitude": 25.7247,
		"latitude": 119.3712,
		"accuracy": 1000,
		"resolving_power_type": "1",
		"resolving_power": "1920,1080",
		"fonts_type": "1",
		"fonts": [],
		"webrtc": "3",
		"webgl_image": "1",
		"canvas_type": "1",
		"webgl_data_type": "1",
		"webgl_factory": "",
		"webgl_info": "ANGLE (AMD, ATI Radeon HD 4200 Direct3D9Ex vs_3_0 ps_3_0, atiumd64.dll-8.14.10.678)",
		"webgpu_data_type": "2",
		"audio_context": "1",
		"media_equipment": "1",
		"javascript_memory_type": "0",
		"client_rects": "1",
		"speech_voices": "1",
		"device_name_source": "1",
		"track": "1",
		"allow_scan_ports": "1",
		"allow_scan_ports_content": "",
		"cloudflare_challenge_bypassing": "0"
	},
	"preference_config": {
		"cookies_backup": "1",
		"indexed_db_backup": "0",
		"local_storage_backup": "0",
		"extension_data_backup": "0",
		"extra_tab_source": "0",
		"open_url": "",
		"block_image": "0",
		"block_audio": "0",
		"block_password_pages": "0",
		"block_restore_pages": "1",
		"block_notification_pages": "1",
		"block_popup_blocking": "1",
		"load_profile_info_page": "1",
		"show_proxy_ip": "1",
		"show_profile_name": "1",
		"show_password": "0",
		"load_bookmarks": "0",
		"show_bookmarks_bar": "0",
		"auto_upload_bookmarks": "0"
	}
}
```

---

## Update Profile Proxy Information - Purchased Residential Proxy

**Método:** `POST`
**URL:** `http://127.0.0.1:53200/api/v2/profile-update-proxy-for-purchased-traffic-package`

### Parâmetros (JSON Body)
| Chave | Obrigatório | Tipo | Descrição |
| --- | --- | --- | --- |
| `profile_id` | ✅ Sim | Integer |  |
| `proxy_info` | ✅ Sim | Object |  |
| `proxy_info.proxy_mode` | ✅ Sim | Integer | Purchased Residential Proxy Specify proxy_mode=1 |
| `proxy_info.proxy_id` | ✅ Sim | Integer | Residential Proxy ID |
| `proxy_info.country` | ❌ Não | String | Country For details, please refer to the Country Appendix |
| `proxy_info.city` | ❌ Não | String | City Can be queried in ixBrowser modification profilr-proxy configuration |
| `proxy_info.gateway` | ✅ Sim | String | Residential Proxy default node. For details, please refer to the Enumeration Variable Appendix. |

### Exemplo de Payload
```json
{
	"profile_id": 1575,
	"proxy_info": {
		"proxy_mode": 1,
		"proxy_id": 6,
		"country": "us",
		"city": "Ada",
		"gateway": "Default"
	}
}
```

---

## Update Profile Proxy Information - Purchased Static Proxy

**Método:** `POST`
**URL:** `http://127.0.0.1:53200/api/v2/profile-update-proxy-to-purchased-mode`

### Parâmetros (JSON Body)
| Chave | Obrigatório | Tipo | Descrição |
| --- | --- | --- | --- |
| `profile_id` | ✅ Sim | Integer |  |
| `proxy_info` | ✅ Sim | Object |  |
| `proxy_info.proxy_mode` | ✅ Sim | Integer | Purchased proxy, specify proxy_mode=3 |
| `proxy_info.proxy_id` | ✅ Sim | Integer | Proxy ID |

### Exemplo de Payload
```json
{
    "profile_id": 161,
    "proxy_info": {
		"proxy_mode":3,
		"proxy_id": 1
	}
}
```

---

## Update Profile Proxy Information - Custom Proxy

**Método:** `POST`
**URL:** `http://127.0.0.1:53200/api/v2/profile-update-proxy-for-custom-proxy`

### Parâmetros (JSON Body)
| Chave | Obrigatório | Tipo | Descrição |
| --- | --- | --- | --- |
| `profile_id` | ✅ Sim | Integer |  |
| `proxy_info` | ✅ Sim | Object |  |
| `proxy_info.proxy_mode` | ✅ Sim | Integer | Custom proxy, specify proxy_mode=2 |
| `proxy_info.proxy_check_line` | ❌ Não | String | Proxy Detection Line Default:global_line proxy_mode is 2 or 4, effect when proxy_type is not direct |
| `proxy_info.proxy_type` | ✅ Sim | String | Proxy Type  direct/socks5/http/ssh |
| `proxy_info.proxy_ip` | ❌ Não | String | Proxy IP   Required when proxy_type is not direct |
| `proxy_info.proxy_port` | ❌ Não | String | Proxy Port   Required when proxy_type is not direct |
| `proxy_info.proxy_user` | ❌ Não | String | Proxy Account |
| `proxy_info.proxy_password` | ❌ Não | String | Proxy Password |

### Exemplo de Payload
```json
{
	"profile_id": 161,
	"proxy_info": {
		"proxy_mode": 2,
		"proxy_check_line": "global_line",
		"proxy_type": "socks5",
		"proxy_ip": "127.0.0.1",
		"proxy_port": "51095",
		"proxy_user": "",
		"proxy_password": ""
	}
}
```

---

## Update Profile Proxy Information - API Extraction

**Método:** `POST`
**URL:** `http://127.0.0.1:53200/api/v2/profile-update-proxy-for-api-extraction`

### Parâmetros (JSON Body)
| Chave | Obrigatório | Tipo | Descrição |
| --- | --- | --- | --- |
| `profile_id` | ✅ Sim | Integer |  |
| `proxy_info` | ✅ Sim | Object |  |
| `proxy_info.proxy_mode` | ✅ Sim | Integer | API Extraction，specify proxy_mode=4 |
| `proxy_info.proxy_check_line` | ✅ Sim | String | Proxy Detection Line  Default:global_line proxy_mode is 2 or 4, effect when proxy_type is not direct |
| `proxy_info.proxy_type` | ✅ Sim | String | Proxy Type |
| `proxy_info.proxy_service` | ✅ Sim | String | Service provider general: general api |
| `proxy_info.proxy_data_format_type` | ✅ Sim | String | Data format type Optional value: txt/json |
| `proxy_info.proxy_data_txt_format` | ❌ Não | String | TXT data format Default: ip:port For details, please refer to the enumeration variable appendix. It takes effect when the API extraction proxy data format type is txt. |
| `proxy_info.proxy_data_json_format` | ❌ Não | Object | json data format mapping relationship |
| `proxy_info.proxy_data_json_format.ip` | ❌ Não | String | Proxy IP mapping field Default: ip |
| `proxy_info.proxy_data_json_format.port` | ❌ Não | String | Proxy Port mapping field Default: port |
| `proxy_info.proxy_data_json_format.username` | ❌ Não | String | Proxy Username mapping field Default: username |
| `proxy_info.proxy_data_json_format.password` | ❌ Não | String | Proxy Password mapping field Default: password |
| `proxy_info.proxy_extraction_method` | ✅ Sim | String | Extraction method invalid: extract a new IP when the IP is invalid every_type: extract a new IP every time the profile is opened |
| `proxy_info.proxy_url` | ✅ Sim | String | Link extraction Required |

### Exemplo de Payload
```json
{
	"profile_id": 161,
	"proxy_info": {
		"proxy_mode": 4,
		"proxy_check_line": "global_line",
		"proxy_type": "socks5",
		"proxy_service": "general",
		"proxy_data_format_type": "txt",
		"proxy_data_txt_format": "ip:port",
		"proxy_data_json_format": {
			"ip": "ip",
			"port": "port",
			"username": "username",
			"password": "password"
		},
		"proxy_extraction_method": "invalid",
		"proxy_url": ""
	}
}
```

---

## Random Fingerprint Configuration

**Método:** `POST`
**URL:** `http://127.0.0.1:53200/api/v2/profile-random-fingerprint-configuration`

### Parâmetros (JSON Body)
| Chave | Obrigatório | Tipo | Descrição |
| --- | --- | --- | --- |
| `profile_id` | ✅ Sim | Integer | Profile serial number |

### Exemplo de Payload
```json
{
    "profile_id": 1442
}
```

---

## Update Profile Groups in Batches

**Método:** `POST`
**URL:** `http://127.0.0.1:53200/api/v2/profile-update-groups-in-batches`

### Parâmetros (JSON Body)
| Chave | Obrigatório | Tipo | Descrição |
| --- | --- | --- | --- |
| `group_id` | ✅ Sim | Integer | Group ID |
| `profile_id` | ✅ Sim | Array | Profile serial number |

### Exemplo de Payload
```json
{
    "group_id": 171,
    "profile_id": [
        170
    ]
}
```

---

## Get Profile Cookies

**Método:** `POST`
**URL:** `http://127.0.0.1:53200/api/v2/profile-get-cookies`

### Parâmetros (JSON Body)
| Chave | Obrigatório | Tipo | Descrição |
| --- | --- | --- | --- |
| `profile_id` | ✅ Sim | Integer | Profile serial number |

### Exemplo de Payload
```json
{
    "profile_id": 13421
}
```

---

## Update Profile Cookies

**Método:** `POST`
**URL:** `http://127.0.0.1:53200/api/v2/profile-update-cookies`

### Parâmetros (JSON Body)
| Chave | Obrigatório | Tipo | Descrição |
| --- | --- | --- | --- |
| `profile_id` | ✅ Sim | Integer | Profile serial number |
| `cookie` | ✅ Sim | String | Cookie  json format |

### Exemplo de Payload
```json
{
    "profile_id": 1342,
    "cookie": "[\n{\"creation_time\":\"1691119532\",\"domain\":\".baidu.com\",\"name\":\"BAIDUID\",\"value\":\"851E73F95773C19D133365C87AD90608:FG=1\",\"path\":\"/\",\"expiration_time\":\"1722583157\",\"last_access_time\":\"1691119532\",\"secure\":false,\"http_only\":false,\"same_site\":\"-1\",\"priority\":\"1\",\"same_party\":false,\"source_scheme\":\"2\",\"source_port\":\"443\",\"is_host_cookie\":false},\n{\"creation_time\":\"1691119532\",\"domain\":\".baidu.com\",\"name\":\"BA_HECTOR\",\"value\":\"ak21202g212gag04042k2k0f1icml7m1o\",\"path\":\"/\",\"expiration_time\":\"1691133557\",\"last_access_time\":\"1691119532\",\"secure\":false,\"http_only\":false,\"same_site\":\"-1\",\"priority\":\"1\",\"same_party\":false,\"source_scheme\":\"2\",\"source_port\":\"443\",\"is_host_cookie\":false},\n{\"creation_time\":\"1691119532\",\"domain\":\".baidu.com\",\"name\":\"BIDUPSID\",\"value\":\"851E73F95773C19D5FF8CC8838218E3A\",\"path\":\"/\",\"expiration_time\":\"1725607157\",\"last_access_time\":\"1691119532\",\"secure\":false,\"http_only\":false,\"same_site\":\"-1\",\"priority\":\"1\",\"same_party\":false,\"source_scheme\":\"2\",\"source_port\":\"443\",\"is_host_cookie\":false},\n{\"creation_time\":\"1691119532\",\"domain\":\".baidu.com\",\"name\":\"PSTM\",\"value\":\"1691047156\",\"path\":\"/\",\"expiration_time\":\"1725607157\",\"last_access_time\":\"1691119532\",\"secure\":false,\"http_only\":false,\"same_site\":\"-1\",\"priority\":\"1\",\"same_party\":false,\"source_scheme\":\"2\",\"source_port\":\"443\",\"is_host_cookie\":false},\n{\"creation_time\":\"1691119532\",\"domain\":\".baidu.com\",\"name\":\"ZFY\",\"value\":\"T2MFXetHwtSdupZOPpsmbRNY9ixO:BaEYizOkGCKZ:A9g:C\",\"path\":\"/\",\"expiration_time\":\"1722583158\",\"last_access_time\":\"1691119532\",\"secure\":true,\"http_only\":false,\"same_site\":\"0\",\"priority\":\"1\",\"same_party\":false,\"source_scheme\":\"2\",\"source_port\":\"443\",\"is_host_cookie\":false},\n{\"creation_time\":\"1691119532\",\"domain\":\"www.baidu.com\",\"name\":\"BD_HOME\",\"value\":\"1\",\"path\":\"/\",\"expiration_time\":\"0\",\"last_access_time\":\"1691119532\",\"secure\":false,\"http_only\":false,\"same_site\":\"-1\",\"priority\":\"1\",\"same_party\":false,\"source_scheme\":\"2\",\"source_port\":\"443\",\"is_host_cookie\":true},\n{\"creation_time\":\"1691119532\",\"domain\":\".baidu.com\",\"name\":\"H_PS_PSSID\",\"value\":\"36556_39110_38831_39114_39116_39040_38918_26350_39132_22159_39100_39043\",\"path\":\"/\",\"expiration_time\":\"0\",\"last_access_time\":\"1691119532\",\"secure\":false,\"http_only\":false,\"same_site\":\"-1\",\"priority\":\"1\",\"same_party\":false,\"source_scheme\":\"2\",\"source_port\":\"443\",\"is_host_cookie\":false},\n{\"creation_time\":\"1691119532\",\"domain\":\"www.baidu.com\",\"name\":\"BD_UPN\",\"value\":\"12314753\",\"path\":\"/\",\"expiration_time\":\"1691983534\",\"last_access_time\":\"1691119534\",\"secure\":false,\"http_only\":false,\"same_site\":\"-1\",\"priority\":\"1\",\"same_party\":false,\"source_scheme\":\"2\",\"source_port\":\"443\",\"is_host_cookie\":true},\n{\"creation_time\":\"1691119532\",\"domain\":\".baidu.com\",\"name\":\"BAIDUID_BFESS\",\"value\":\"851E73F95773C19D133365C87AD90608:FG=1\",\"path\":\"/\",\"expiration_time\":\"1722655535\",\"last_access_time\":\"1691119535\",\"secure\":true,\"http_only\":false,\"same_site\":\"0\",\"priority\":\"1\",\"same_party\":false,\"source_scheme\":\"2\",\"source_port\":\"443\",\"is_host_cookie\":false},\n{\"creation_time\":\"1691119537\",\"domain\":\".ixbrowser.com\",\"name\":\"_ga_8XCJ3YF17N\",\"value\":\"GS1.1.1691117948.2.1.1691119537.0.0.0\",\"path\":\"/\",\"expiration_time\":\"1725679537\",\"last_access_time\":\"1691119537\",\"secure\":false,\"http_only\":false,\"same_site\":\"-1\",\"priority\":\"1\",\"same_party\":false,\"source_scheme\":\"2\",\"source_port\":\"443\",\"is_host_cookie\":false},\n{\"creation_time\":\"1691119532\",\"domain\":\".ixbrowser.com\",\"name\":\"_ga\",\"value\":\"GA1.1.1114785102.1691053919\",\"path\":\"/\",\"expiration_time\":\"1725679537\",\"last_access_time\":\"1691119537\",\"secure\":false,\"http_only\":false,\"same_site\":\"-1\",\"priority\":\"1\",\"same_party\":false,\"source_scheme\":\"2\",\"source_port\":\"443\",\"is_host_cookie\":false}\n]"
}
```

---

## Delete Profile

**Método:** `POST`
**URL:** `http://127.0.0.1:53200/api/v2/profile-delete`

### Parâmetros (JSON Body)
| Chave | Obrigatório | Tipo | Descrição |
| --- | --- | --- | --- |
| `profile_id` | ✅ Sim | Integer | Profile serial number |

### Exemplo de Payload
```json
{
    "profile_id":161
}
```

---

## Empty Recycle Bin

**Método:** `POST`
**URL:** `http://127.0.0.1:53200/api/v2/empty-recycle-bin`

### Parâmetros (JSON Body)
| Chave | Obrigatório | Tipo | Descrição |
| --- | --- | --- | --- |
| `page` | ❌ Não | Integer | Number of pages Default: 1 |
| `limit` | ❌ Não | Integer | Number of returns per page Default: 10 |
| `group_id` | ❌ Não | Integer | Group ID |
| `tag_id` | ✅ Sim | Integer | Tag ID |
| `name` | ❌ Não | String | Profile Name |

### Exemplo de Payload
```json
{}
```

---

## Create Profile Transfer Code

**Método:** `POST`
**URL:** `http://127.0.0.1:53200/api/v2/profile-transfer-code-create`

### Parâmetros (JSON Body)
| Chave | Obrigatório | Tipo | Descrição |
| --- | --- | --- | --- |
| `profile_id` | ✅ Sim | Integer | Profile serial number |
| `transfer_proxy` | ❌ Não | Integer | Transfer Proxy  0:Don't Transfer 1:Transfer  Default:0  （The proxy does not take effect when it is in traffic packet or direct connection mode） |
| `transfer_proxy_mode` | ❌ Não | Integer | Options of Transfering Proxy 1:Proxy Sharing 2:Proxy Transfer  Default:1（It takes effect when transferring proxy and the proxy bound with the profile is a purchased proxy） |
| `transfer_note` | ❌ Não | Integer | Transfer Notes  0:Don't Transfer 1:Transfer  Default:0 |
| `password` | ✅ Sim | String | Login Password |

### Exemplo de Payload
```json
{
    "profile_id": 1441,
    "transfer_proxy": 1,
    "transfer_proxy_mode": 1,
    "transfer_note": 1,
    "password": "123456"
}
```

---

## Cancel Profile Transfer Code

**Método:** `POST`
**URL:** `http://127.0.0.1:53200/api/v2/profile-transfer-cancel`

### Parâmetros (JSON Body)
| Chave | Obrigatório | Tipo | Descrição |
| --- | --- | --- | --- |
| `profile_id` | ✅ Sim | Integer | Profile serial number |

### Exemplo de Payload
```json
{
    "profile_id": 1606
}
```

---

## Import Profile via Transfer Code

**Método:** `POST`
**URL:** `http://127.0.0.1:53200/api/v2/profile-transfer-code-import`

### Parâmetros (JSON Body)
| Chave | Obrigatório | Tipo | Descrição |
| --- | --- | --- | --- |
| `transfer_code` | ✅ Sim | String | Transfer Code |
| `group_id` | ❌ Não | Integer | The group ID assigned to the profile. If the ID is not uploaded, the profile will be assigned to the default group |
| `proxy_config` | ❌ Não | Object | Proxy Information Configuration |
| `proxy_config.proxy_mode` | ❌ Não | Integer | Proxy Method  For details, please refer to the enumeration variable appendix |
| `proxy_config.proxy_id` | ❌ Não | String | Proxy ID  Required when proxy_mode is not 2 |
| `proxy_config.proxy_type` | ❌ Não | String | Proxy Type For details, please refer to the enumeration variable appendix |
| `proxy_config.proxy_ip` | ❌ Não | String | Proxy IP  Required when proxy_mode is 2, and the proxy_type is not in direct mode |
| `proxy_config.proxy_port` | ❌ Não | String | Proxy Port  Required when proxy_mode is 2, and the proxy_type is not in direct mode |
| `proxy_config.proxy_user` | ❌ Não | String | Proxy Account |
| `proxy_config.proxy_password` | ❌ Não | String | Proxy Password |
| `proxy_config.traffic_package_ip_policy` | ❌ Não | Boolean | IP Policy false:Keep the IP unchanged (5~60 minutes) true:Get a new IP when everytime open the profile It takes effect when proxy_mode is 1 |
| `proxy_config.enable_bypass` | ✅ Sim | String | Bypass List 0:Close 1:Open |
| `proxy_config.bypass_list` | ✅ Sim | String | The domains that do not go through the proxy, separate by newlines |

### Exemplo de Payload
```json
{
    "transfer_code": "76686828-89727101",
    "group_id":1,//The group ID assigned to the profile. If the ID is not uploaded, the profile will be assigned to the default group
    "proxy_config": {
        "proxy_mode": 2, ///Proxy Method  For details, please refer to the enumeration variable appendix
        "proxy_id": "", //Proxy ID  Required when proxy_mode is not 2
        "proxy_type": "direct", //Proxy Type For details, please refer to the enumeration variable appendix
        "proxy_ip": "", //Proxy IP  Required when proxy_mode is 2, and the proxy_type is not in direct mode
        "proxy_port": "", //Proxy Port  Required when proxy_mode is 2, and the proxy_type is not in direct mode
        "proxy_user": "", //Proxy Account
        "proxy_password": "", //Proxy Password
        "traffic_package_ip_policy": false, //IP Policy false:Keep the IP unchanged (5~60 minutes) true:Get a new IP when everytime open the profile It takes effect when proxy_mode is 1
        "enable_bypass": "0", //Bypass List 0:Close 1:Open
        "bypass_list": "*.example1.com\nwww.example2.com" //The domains that do not go through the proxy, separate by newlines
    } //Proxy Information Configuration（After configuration, the original proxy information imported into the profile will be overwritten.）
}
```

---

## Get Profile Transfer Records List

**Método:** `POST`
**URL:** `http://127.0.0.1:53200/api/v2/profile-transfer-record-list`

### Parâmetros (JSON Body)
| Chave | Obrigatório | Tipo | Descrição |
| --- | --- | --- | --- |
| `type` | ❌ Não | Integer | Type 1:Transfer Records 2:Receive Records  Default：1 |
| `title` | ❌ Não | String | Profile Name |
| `page` | ❌ Não | Integer | Number of pages Default: 1 |
| `limit` | ❌ Não | Integer | Number of returns per page Default: 10 |

### Exemplo de Payload
```json
{
    "type": 2,
    "title":"",
    "page": 1,
    "limit": 10
}
```

---

## Get Group

**Método:** `POST`
**URL:** `http://127.0.0.1:53200/api/v2/group-list`

### Parâmetros (JSON Body)
| Chave | Obrigatório | Tipo | Descrição |
| --- | --- | --- | --- |
| `page` | ❌ Não | Integer | Number of pages Default: 1 |
| `limit` | ❌ Não | Integer | Number of returns per page Default: 10 |
| `title` | ❌ Não | String | Group Name |

### Exemplo de Payload
```json
{
    "page":1,
    "limit": 10,
    "title":""
}
```

---

## Create Group

**Método:** `POST`
**URL:** `http://127.0.0.1:53200/api/v2/group-create`

### Parâmetros (JSON Body)
| Chave | Obrigatório | Tipo | Descrição |
| --- | --- | --- | --- |
| `title` | ✅ Sim | String | Group Name |
| `sort` | ✅ Sim | Integer | Sort |

### Exemplo de Payload
```json
{
    "title": "name",
    "sort": 0
}
```

---

## Update Group

**Método:** `POST`
**URL:** `http://127.0.0.1:53200/api/v2/group-update`

### Parâmetros (JSON Body)
| Chave | Obrigatório | Tipo | Descrição |
| --- | --- | --- | --- |
| `title` | ✅ Sim | String | Group Name |
| `id` | ✅ Sim | Integer | Group ID |
| `sort` | ❌ Não | Integer | Sort |

### Exemplo de Payload
```json
{
    "title": "测试分组123",
    "id":1835
}
```

---

## Delete Group

**Método:** `POST`
**URL:** `http://127.0.0.1:53200/api/v2/group-delete`

### Parâmetros (JSON Body)
| Chave | Obrigatório | Tipo | Descrição |
| --- | --- | --- | --- |
| `id` | ✅ Sim | Integer | Group ID |

### Exemplo de Payload
```json
{
    "id": 182
}
```

---

## Get Tag

**Método:** `POST`
**URL:** `http://127.0.0.1:53200/api/v2/tag-list`

### Parâmetros (JSON Body)
| Chave | Obrigatório | Tipo | Descrição |
| --- | --- | --- | --- |
| `page` | ❌ Não | Integer | Number of pages Default: 1 |
| `limit` | ❌ Não | Integer | Number of returns per page Default: 10 |
| `title` | ❌ Não | String | Tag Name |

### Exemplo de Payload
```json
{
    "page":1,
    "limit": 10,
    "title":""
}
```

---

## Create Tag

**Método:** `POST`
**URL:** `http://127.0.0.1:53200/api/v2/tag-create`

### Parâmetros (JSON Body)
| Chave | Obrigatório | Tipo | Descrição |
| --- | --- | --- | --- |
| `title` | ✅ Sim | String | Tag Name |

### Exemplo de Payload
```json
{
    "title": "name"
}
```

---

## Update Tag

**Método:** `POST`
**URL:** `http://127.0.0.1:53200/api/v2/tag-update`

### Parâmetros (JSON Body)
| Chave | Obrigatório | Tipo | Descrição |
| --- | --- | --- | --- |
| `title` | ✅ Sim | String | Tag Name |
| `id` | ✅ Sim | Integer | Tag ID |

### Exemplo de Payload
```json
{
    "title": "test",
    "id": 14
}
```

---

## Delete Tag

**Método:** `POST`
**URL:** `http://127.0.0.1:53200/api/v2/tag-delete`

### Parâmetros (JSON Body)
| Chave | Obrigatório | Tipo | Descrição |
| --- | --- | --- | --- |
| `id` | ✅ Sim | Integer | Tag ID |

### Exemplo de Payload
```json
{
    "id": 182
}
```

---

## Get the Residential Proxy List

**Método:** `POST`
**URL:** `http://127.0.0.1:53200/api/v2/traffic-package-list`

### Parâmetros (JSON Body)
| Chave | Obrigatório | Tipo | Descrição |
| --- | --- | --- | --- |
| `page` | ❌ Não | Integer | Number of pages Default: 1 |
| `limit` | ❌ Não | Integer | Number of returns per page Default: 10 |

### Exemplo de Payload
```json
{
    "page":1,
    "limit": 10
}
```

---

## Get Proxy List

**Método:** `POST`
**URL:** `http://127.0.0.1:53200/api/v2/proxy-list`

### Parâmetros (JSON Body)
| Chave | Obrigatório | Tipo | Descrição |
| --- | --- | --- | --- |
| `page` | ❌ Não | Integer | Number of pages Default: 1 |
| `limit` | ❌ Não | Integer | Number of returns per page Default: 10 |
| `id` | ❌ Não | Integer | Proxy ID |
| `type` | ❌ Não | Integer | Proxy type 0: All 1: Custom agent 2: Purchased proxy Default: 0 |
| `proxy_ip` | ❌ Não | String | Proxy IP |
| `tag_id` | ❌ Não | Integer | Proxy Tag ID |

### Exemplo de Payload
```json
{
    "page": 1,
    "limit": 10,
    "id": 0,
    "type": 0,
    "proxy_ip": "",
    "tag_id": 0
}
```

---

## Create Custom Proxy

**Método:** `POST`
**URL:** `http://127.0.0.1:53200/api/v2/proxy-create`

### Parâmetros (JSON Body)
| Chave | Obrigatório | Tipo | Descrição |
| --- | --- | --- | --- |
| `proxy_type` | ✅ Sim | String | Proxy type http/https/scoks5/ssh |
| `proxy_ip` | ✅ Sim | String | Proxy IP |
| `proxy_port` | ✅ Sim | String | Proxy Port |
| `proxy_user` | ✅ Sim | String | Proxy Account |
| `proxy_password` | ❌ Não | String | Proxy Password |
| `tag` | ❌ Não | String | Tag name (If there are multiple tags, please sendin array format) |
| `note` | ❌ Não | String | Proxy Notes |

### Exemplo de Payload
```json
{
    "proxy_type": "socks5",
    "proxy_ip": "127.0.0.1",
    "proxy_port": "57425",
    "proxy_user": "",
    "proxy_password": "",
    "tag": "",
    "note": ""
}
```

---

## Update Custom Proxy

**Método:** `POST`
**URL:** `http://127.0.0.1:53200/api/v2/proxy-update`

### Parâmetros (JSON Body)
| Chave | Obrigatório | Tipo | Descrição |
| --- | --- | --- | --- |
| `id` | ✅ Sim | Integer | Proxy ID |
| `proxy_type` | ❌ Não | String | Proxy type http/https/scoks5/ssh |
| `proxy_ip` | ❌ Não | String | Proxy IP |
| `proxy_port` | ❌ Não | String | Proxy Port |
| `proxy_user` | ❌ Não | String | Proxy Account |
| `proxy_password` | ❌ Não | String | Proxy Password |
| `tag` | ❌ Não | String | Tag name (If there are multiple tags, please sendin array format) |
| `note` | ❌ Não | String | Proxy Notes |

### Exemplo de Payload
```json
{
	"id": 24330,
	"proxy_type": "socks5",
	"proxy_ip": "127.0.0.2",
	"proxy_port": "57425",
	"proxy_user": "",
	"proxy_password": "",
	"tag": "",
	"note": ""
}
```

---

## Delete Custom Proxy

**Método:** `POST`
**URL:** `http://127.0.0.1:53200/api/v2/proxy-delete`

### Parâmetros (JSON Body)
| Chave | Obrigatório | Tipo | Descrição |
| --- | --- | --- | --- |
| `id` | ✅ Sim | Integer | Proxy ID |

### Exemplo de Payload
```json
{
    "id": 2444
}
```

---

## Get Proxy Tag

**Método:** `POST`
**URL:** `http://127.0.0.1:53200/api/v2/proxy-tag-list`

### Parâmetros (JSON Body)
| Chave | Obrigatório | Tipo | Descrição |
| --- | --- | --- | --- |
| `page` | ❌ Não | Integer | Number of pages Default: 1 |
| `limit` | ❌ Não | Integer | Number of returns per page Default: 10 |
| `title` | ❌ Não | String | Tag Name |

### Exemplo de Payload
```json
{
    "page":1,
    "limit": 10,
    "title":""
}
```

---

## Create Proxy Tag

**Método:** `POST`
**URL:** `http://127.0.0.1:53200/api/v2/proxy-tag-create`

### Parâmetros (JSON Body)
| Chave | Obrigatório | Tipo | Descrição |
| --- | --- | --- | --- |
| `title` | ✅ Sim | String | Tag Name |

### Exemplo de Payload
```json
{
    "title": "name"
}
```

---

## Update Proxy Tag

**Método:** `POST`
**URL:** `http://127.0.0.1:53200/api/v2/proxy-tag-update`

### Parâmetros (JSON Body)
| Chave | Obrigatório | Tipo | Descrição |
| --- | --- | --- | --- |
| `title` | ✅ Sim | String | Tag Name |
| `id` | ✅ Sim | Integer | Tag ID |

### Exemplo de Payload
```json
{
    "title": "test",
    "id": 14
}
```

---

## Delete Proxy Tag

**Método:** `POST`
**URL:** `http://127.0.0.1:53200/api/v2/proxy-tag-delete`

### Parâmetros (JSON Body)
| Chave | Obrigatório | Tipo | Descrição |
| --- | --- | --- | --- |
| `id` | ✅ Sim | Integer | Tag ID |

### Exemplo de Payload
```json
{
    "id": 182
}
```

---

## Get Gateway List

**Método:** `POST`
**URL:** `http://127.0.0.1:53200/api/v2/gateway-list`

---

## Switch Access Gateway

**Método:** `POST`
**URL:** `http://127.0.0.1:53200/api/v2/gateway-switch`

### Parâmetros (JSON Body)
| Chave | Obrigatório | Tipo | Descrição |
| --- | --- | --- | --- |
| `id` | ✅ Sim | String | Gateway ID: obtained by getting the gateway list |

### Exemplo de Payload
```json
{
	"id": "1"
}
```

---

## Appendix

**Método:** `POST`
**URL:** `undefined`

---

## Script Example

**Método:** `POST`
**URL:** `undefined`

---

