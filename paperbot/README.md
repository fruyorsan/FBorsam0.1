# PaperBot — AI Destekli Sanal (Paper) Kripto/DeFi İşlem Sistemi

> **⚠ SANAL TEST MODU — Yatırım tavsiyesi değildir.**
> Bu sistem gerçek para kullanmaz; sanal bakiyeyle analiz yapar, sanal
> alım-satım kararı verir ve performansını ölçer. Gerçek borsa/cüzdan API'leri
> **sen** bağlayana kadar `ExecutionProvider` arayüzünün sanal (paper)
> implementasyonu çalışır. Canlı işlem modu **varsayılan olarak kapalıdır**.

---

## 1. İçindekiler

1. [Özellikler](#2-özellikler)
2. [Teknoloji yığını](#3-teknoloji-yığını)
3. [Hızlı kurulum (yerel)](#4-hızlı-kurulum-yerel)
4. [Docker ile kurulum](#5-docker-ile-kurulum)
5. [Ayarlar (.env ve panelden)](#6-ayarlar)
6. [Panel (dashboard) turu](#7-panel-dashboard-turu)
7. [REST API özeti](#8-rest-api-özeti)
8. [Mimari: katmanlar nasıl genişletilir](#9-mimari-katmanlar-nasıl-genişletilir)
9. [Gerçek borsa entegrasyonu (Faz 10 — aktif)](#10-gerçek-borsa-entegrasyonu-faz-10--aktif)
10. [LLM gerekçe köprüsü (Faz 11)](#11-llm-gerekçe-köprüsü-faz-11--opencode)
11. [Kendi sunucuna taşıma](#12-kendi-sunucuna-taşıma)
12. [Testler](#13-testler)

---

## 2. Özellikler

**Sanal işlem motoru (ana öncelik)**
- Ayarlanabilir başlangıç bakiyesi (varsayılan 10.000 USDT)
- Otomatik sanal alım/satım, stop-loss ve take-profit
- Gerçekçi maliyet modeli: **komisyon + slippage + gas** (hepsi ayarlanabilir;
  varsayılanlar kasten kötümser: %0.12 komisyon, %0.35 slippage, 2 USDT gas)
- Pozisyon kuralları: varlık başına maks sermaye oranı, maks eşzamanlı pozisyon
- Günlük maks zarar limiti → yeni işlemi durdurur + bildirim gönderir
- **Kill switch**: panelden tek tuşla tüm sistemi durdurur, açık pozisyonları kapatır
- Performans: toplam PnL, kazanma oranı, ort. kâr/zarar, max drawdown, Sharpe,
  işlem sayısı — **strateji bazında** ve **katman bazında** ayrı ayrı
- **Backtest**: aynı strateji kodu geçmiş Binance OHLCV verisiyle çalışır

**Analiz katmanları (6 katman, ayrı skor, ayarlanabilir ağırlık)**
| Katman | Faz 1 durumu | Kaynak |
|---|---|---|
| Piyasa & teknik | ✅ canlı (halka açık) | Binance klines (anahtarsız) |
| On-chain & akıllı para | ✅ Faz 2 aktif | cüzdan portföyleri (mock/Etherscan), fark sinyalleri, isabet oranı |
| DeFi metrikleri | ✅ Faz 3 aktif | DefiLlama TVL trend/derinlik/ücret/APY — anahtarsız |
| Risk & güvenlik | ✅ Faz 4 aktif | DefiLlama (denetim/hack/yaş) + GoPlus (honeypot/kontrat) — anahtarsız |
| Duygu & haber | ✅ Faz 5 aktif | Google News RSS (haber) + Korku&Açgözlülük + CoinGecko trend — anahtarsız |
| Makro | ✅ Faz 6 aktif | CoinGecko piyasa/dominans + stablecoin arzı + ECB dolar gücü — anahtarsız |

**Karar mantığı**
- Her katman 0–100 skor üretir; ağırlıklı birleştirilir (normalize edilir)
- **Risk filtresi ( veto )**: güvenlik skoru eşiğin altındaysa diğer skorlar ne
  olursa olsun işlem **açılmaz**, varlık "riskli" işaretlenir
- **Akıllı para tek başına açtırmaz**: teknik minimum + en az N katman teyidi gerekir
- Her karar için **gerekçe** (hangi veri, hangi katman, güven, olasılık aralığı,
  riskler) üretilir ve DB'de saklanır
- **Karşılaştırma raporu**: "sinyali olan işlemler" vs "olmayanlar" — hangi katman
  gerçekten katkı sağlıyor veriyle görünür

**Veri katmanı**
- Her kaynak ayrı adaptör; API anahtarları yalnızca `.env`'de
- Anahtar girilmemiş kaynaklar hata vermez → ücretsiz endpoint veya mock'a düşer
- Cache + retry + 429 rate-limit yönetimi her adaptörde ortak

**Panel**: skorlar, pozisyonlar, portföy grafiği, performans, sinyal geçmişi
(gerekçeli), ayarlar, cüzdanlar, backtest, dışa aktarım (CSV/JSON)

---

## 3. Teknoloji yığını

| Katman | Seçim | Gerekçe |
|---|---|---|
| Backend | Python 3.12+ / FastAPI | asenkron 5 dk döngü, tip güvenliği, taşınabilir |
| Zamanlayıcı | asyncio (kendi döngümüz) | kill-switch/duraklatma kontrolü tamamen bizde |
| DB | SQLAlchemy → SQLite (vars.) / PostgreSQL | tek config ile geçiş, standart SQL |
| Arayüz | Vanilla JS + Chart.js (yerel vendor) | build zinciri yok, sitene kolay gömülür |
| Veri | httpx + cache/retry/rate-limit | anahtarsız halka açık uçlar + mock yedek |
| Dağıtım | Docker Compose | `docker compose up` ile kendi sunucunda |

---

## 4. Hızlı kurulum (yerel)

```powershell
# 1) Bağımlılıklar (Python 3.11+)
python -m venv .venv
.venv\Scripts\activate        # Linux/macOS: source .venv/bin/activate
pip install -r requirements-dev.txt

# 2) Yapılandırma
copy .env.example .env        # PowerShell: Copy-Item .env.example .env

# 3) Çalıştır
python -m uvicorn paperbot.main:app --host 127.0.0.1 --port 8000
# veya: python -m paperbot.main
```

Panel: **http://127.0.0.1:8000/** · API dokümanı: **http://127.0.0.1:8000/docs**

İlk açılışta:
- `data/paperbot.db` otomatik oluşur, 20 varsayılan varlık eklenir
- Sanal bakiye 10.000 USDT olarak açılır
- Zamanlayıcı her **5 dakikada** (varsayılan) analiz+karar döngüsü çalıştırır
- Paneldeki **"▶ Şimdi Analiz Et"** ile anında tek çevrim tetikleyebilirsin

Testler: `pytest -q` → 43 test (ağ erişimi gerektirmez).

---

## 5. Docker ile kurulum

```bash
cp .env.example .env          # değerleri düzenle
docker compose up -d --build
docker compose logs -f        # loglar
```

- Panel: http://localhost:8000
- `./data` ve `./logs` host'a bağlıdır (kalıcı)
- PostgreSQL'e geçmek için `docker-compose.yml` içindeki `db` servisini aç ve
  `DATABASE_URL=postgresql+psycopg://paperbot:paperbot@db:5432/paperbot` ayarla.

---

## 6. Ayarlar

Tüm ayarlar iki katmandan gelir: **`.env` (varsayılan)** + **DB (panel override)**.
Panelde yapılan değişiklikler `.env`'i değiştirmez; DB'de saklanır ve bir sonraki
çevrimde uygulanır.

| Grup | Anahtarlar (varsayılan) |
|---|---|
| Sanal işlem | `START_BALANCE=10000`, `CYCLE_SECONDS=300` |
| Maliyetler (kötümser) | `FEE_RATE=0.0012`, `SLIPPAGE_RATE=0.0035`, `GAS_PER_TRADE=2.0` |
| Risk | `MAX_POSITION_PCT=0.10`, `MAX_OPEN_positions=5`, `DAILY_MAX_LOSS_PCT=0.03`, `STOP_LOSS_PCT=0.08`, `TAKE_PROFIT_PCT=0.15`, `RISK_MIN_SCORE=40` |
| Ağırlıklar | `W_TECHNICAL=0.25`, `W_ONCHAIN=0.15`, `W_DEFI=0.10`, `W_RISK=0.30`, `W_SENTIMENT=0.10`, `W_MACRO=0.10` |
| Karar | `ENTRY_THRESHOLD=65`, `EXIT_THRESHOLD=40`, `TECHNICAL_MIN=50`, `CONFIRMATIONS_REQUIRED=2` |
| Veri | `PRICE_SOURCE=auto` (auto/mock/binance/coingecko) |
| Bildirim | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` (boşsa log/panel) |
| LLM | `OPENAI_API_KEY` (boşsa şablon gerekçe) |
| **Korumalı** | `LIVE_TRADING_ENABLED`, `TRADING_MODE`, `DATABASE_URL`, gizli anahtarlar |

**Telegram kurulumu**: `@BotFather`'dan bot al → token'ı ve `TELEGRAM_CHAT_ID`'ni
`.env`'e yaz. Girilmezse sistem hata vermez; bildirimler panele ve
`logs/paperbot.log` dosyasına düşer.

**Bildirim olayları**: yeni işlem açıldı/kapatıldı, take-profit, günlük zarar
limiti aşıldı, kill switch, sistem hatası, günlük + haftalık özet.

---

## 7. Panel (dashboard) turu

| Sekme | İçerik |
|---|---|
| 📊 Genel Bakış | portföy değeri + grafik, günlük PnL, kill switch/analiz butonları, son olaylar, güncel skor tablosu |
| 🪙 Varlıklar | 6 katman skoru (canlı/mock etiketiyle), nihai skor, risk seviyesi, karar |
| 💼 Pozisyonlar | açık + kapalı sanal pozisyonlar, SL/TP, PnL, **her işlemin gerekçesi** |
| 📡 Sinyaller | her karar: skor, güven, olasılık aralığı, risk seviyesi, **tam gerekçe** (tıkla→açılır) |
| 📈 Performans | metrikler, strateji/katman/çıkış nedeni kırılımı, **katman katkı raporu** |
| 🧪 Backtest | gün/zaman dilimi seç → geçmişte aynı stratejiyi çalıştır, eğri + işlemler |
| 🐋 Cüzdanlar | cüzdan CRUD + portföy anlık görüntüleri, **akıllı para sinyalleri**, manuel tazeleme, isabet oranı (hit-rate) değerlendirmesi |
| ⚙ Ayarlar | varlıklar, ağırlıklar, eşikler, ücretler, bakiye, dışa aktarım |

Her sayfada **"SANAL TEST MODU — yatırım tavsiyesi değildir"** uyarısı görünür.

---

## 8. REST API özeti

Base: `/api` · interaktif docs: `/docs`

```
GET  /api/status                 sistem durumu (kill switch, halt, bakiye, ...)
GET  /api/assets                 varlıklar + katman skorları + kararlar
POST /api/assets                 varlık ekle       PUT /api/assets   aç/kapa
DELETE /api/assets/{symbol}      varlık sil
GET  /api/positions?status=      açık/kapalı pozisyonlar
GET  /api/equity                 portföy zaman serisi
GET  /api/metrics                genel + strateji + katman performansı
GET  /api/compare?layer=onchain  sinyalli vs sinyalsiz karşılaştırma
GET  /api/signals                sinyal geçmişi (gerekçeli)
GET  /api/settings  PUT /api/settings     ayarlar
POST /api/system/cycle           tek çevrim çalıştır
POST /api/system/kill-switch     {enable:true} durdur + kapat
POST /api/system/resume          duraklatmayı kaldır
POST /api/system/reset           {balance:10000} portföyü sıfırla
POST /api/backtest               geçmiş test (aynı strateji kodu)
GET  /api/notifications          bildirim geçmişi
GET/POST/PATCH/DELETE /api/wallets       takip cüzdanları
GET  /api/wallets/{id}/portfolio   cüzdan portföyü + hareket geçmişi
POST /api/wallets/refresh          portföyleri hemen tazele (?evaluate_hits=true)
GET  /api/smart-money              token bazlı akıllı para sinyalleri (kanıt cüzdanlarla)
GET  /api/risk/{symbol}            Faz 4 risk & güvenlik bileşen detayları
GET  /api/defi/{symbol}            Faz 3 DeFi metrik bileşen detayları
GET  /api/sentiment/{symbol}       Faz 5 duygu & haber bileşen detayları
GET  /api/macro/{symbol}           Faz 6 makro bileşen detayları
GET  /api/export/trades.csv      trades|decisions|equity · .csv/.json
```

Panel tamamen bu API'yi kullanır; başka bir frontend (React vb.) yazmak ya da
paneli kendi sitene gömmek için ek bir şey gerekmez.

---

## 9. Mimari: katmanlar nasıl genişletilir

```
paperbot/
├── config.py          # .env → AppConfig (tüm ayar anahtarları)
├── settings_store.py  # DB override + doğrulama
├── models.py          # SQLAlchemy tabloları
├── db.py              # oturum + seed
├── context.py         # bileşen bağlama (AppContext)
├── scheduler.py       # 5 dk döngü + özet raporlar
├── main.py            # FastAPI + statik panel
├── api/routes.py      # REST uçları
├── core/
│   ├── scoring.py     # LayerProvider arayüzü + TECHNİK katman + MockLayer
│   ├── decision.py    # ağırlıklı birleştirme + gerekçe + risk filtresi + LLM
│   ├── paper_engine.py# ★ sanal motor + ExecutionProvider arayüzü
│   ├── onchain.py     # ★ Faz 2: cüzdan pipeline + OnchainLayer (6 bileşen)
│   ├── defi.py        # ★ Faz 3: DefiLayer (4 bileşen: trend/derinlik/ücret/APY)
│   ├── risk.py        # ★ Faz 4: RiskLayer (4 bileşen + kritik tavanlar)
│   ├── sentiment.py   # ★ Faz 5: SentimentLayer (3 bileşen: FNG/haber/dikkat)
│   ├── macro.py       # ★ Faz 6: MacroLayer (4 bileşen: likidite/piyasa/dom/dolar)
│   ├── metrics.py     # drawdown/Sharpe/katman karşılaştırma
│   └── backtest.py    # aynı motoru geçmiş veriyle çalıştırır
├── data/
│   ├── base.py        # HttpFetcher (cache/retry/rate-limit + get_text/RSS)
│   ├── onchain.py     # mock cüzdan portföyleri + Etherscan adaptörü
│   ├── defi.py        # ★ Faz 3: DefiLlama TVL/ücret/yields (anahtarsız)
│   ├── sentiment.py   # ★ Faz 5: Google News RSS + FNG + trending (anahtarsız)
│   ├── macro.py       # ★ Faz 6: CoinGecko /global + stablecoin + ECB (anahtarsız)
│   ├── security.py    # ★ Faz 4: DefiLlama (denetim/hack) + GoPlus (kontrat)
│   └── pricefeed.py   # binance/coingecko/mock + geçmiş OHLCV
├── notify/telegram.py # Telegram (opsiyonel) + kalıcı bildirim
└── web/               # panel (statik)
```

### Yeni katman ekleme (Faz 2-6 örneği: on-chain)

1. `core/scoring.py`'ye sınıf yaz — arayüz tek satır:

```python
class OnchainLayer:
    name = "onchain"
    source = "live"
    def compute(self, symbol, feed, cfg) -> LayerScore:
        data = my_adapter.get_wallet_flows(symbol)      # data/ adaptörün
        score = ... 0..100
        return LayerScore("onchain", score, "live", details={...})
```

2. `build_default_registry()` içinde `MockLayer("onchain")` yerine `OnchainLayer()` koy.
   Karar motoru, panel, backtest ve metrikler **hiç değişmeden** yeni veriyi kullanır.

3. `data/` içine adaptörünü yaz: `HttpFetcher` kullan, `None` dönmeyi ve
   `.env`'deki anahtar okunmamışsa mock'a düşmeyi varsay.

> Aynısı `execution` için de geçerli: yeni bir `ExecutionProvider` sınıfı yaz,
> `build_provider()`'da seç — motor geri kalanı aynı kalır.

---

## 10. Gerçek borsa entegrasyonu (Faz 10 — aktif)

`BinanceExecutionProvider` (`paperbot/core/binance_exec.py`) gerçek spot
emirlerini yürütür. **Varsayılan kapalıdır**; açmak için:

1. Binance → Profile → API Management: anahtar oluştur
   (**Enable Reading** + **Enable Spot & Margin Trading**; Withdraw kapalı).
2. Panel → **Ayarlar → "Binance API & Canlı İşlem"** kartına key+secret gir
   ("Anahtarları Kaydet & Canlı Modu Aç"). Anahtar Binance'te imzalı
   `/account` ile doğrulanır ve **`.env` dosyasına** yazılır
   (`BINANCE_API_KEY/SECRET`); veritabanına asla konmaz.
   Ya da elle: `.env`'ye `TRADING_MODE=live`,
   `LIVE_TRADING_ENABLED=true`, `BINANCE_API_KEY=…`,
   `BINANCE_API_SECRET=…` yazıp sunucuyu yeniden başlat.
3. İlk deneme için `BINANCE_TESTNET=true` + testnet anahtarı önerilir
   (testnet anahtarları gerçek anahtardan farklıdır).

Güvenlik katmanları:
- Çift kilit: mod != live **veya** flag kapalı **veya** anahtar yoksa
  emir gitmez; backtest her koşulda paper.
- Her çevrimde bakiye borsadan senkronlanır; alınamazsa o çevrimde yeni
  giriş yok. Satış miktarı LOT_SIZE'a yuvarlanır, bakiye aşılmaz.
- Kill switch + günlük zarar limiti canlı modda da geçerlidir
  (kill switch gerçek pozisyonları da satar).
- "Canlı Modu Kapat" → `.env` güncellenir, pozisyonlar sanal kapanır;
  **borsadaki gerçek varlıklar satılmaz** (onları manuel yönet).
- Açık pozisyonlar DB'de tutulur; borsa ile pozisyon mutabakatı
  (dust/reconcile) şimdilik manueldir — README'deki "küçük başla" önerisi
  geçerlidir: düşük `max_position_pct` + düşük `MAX_POSITION_PCT` ile başla.

Öneri: canlıya geçmeden önce en az N hafta backtest + sanal mod sonucunu
karşılaştır; kill switch'i canlıda da ilk şart yap.

---

## 11. LLM gerekçe köprüsü (Faz 11 — OpenCode)

Karar gerekçeleri (`açılış`/`çıkış`/`risk_blok`) LLM ile zenginleştirilebilir.
OpenAI kredisi tükendiğinde **hesapta zaten giriş yapılmış OpenCode API'si**
köprü olarak kullanılır — model bedelleri `0` (ücretsiz) veya kullanıcının mevcut
sağlayıcı kredisiyle çalışır:

```env
LLM_BRIDGE=opencode          # "" = sadece OpenAI; "opencode" = yerel köprü
LLM_PROVIDER=google          # opencode API sağlayıcısı (google | opencode | …)
LLM_MODEL=gemini-3.8-flash   # güçlü model; ücretsiz alternatif: space-bunny-free
LLM_VARIANT=high             # model varyantı (varyantsız modelde otomatik düşer)
LLM_FALLBACKS=opencode/space-bunny-free   # ana model503/400 verirse sırayla denenir
LLM_TIMEOUT=90               # köprü azami süresi (sn)
OPENCODE_CMD=                # boş = otomatik bul (npm'deki opencode.cmd)
```

- **Zincir:** OpenCode köprüsü (ana model → **yedek model** → …) → OpenAI
  (anahtar varsa) → şablon. Hiçbiri çalışmazsa karar asla etkilenmez; motor
  sessizce şablona döner.
- Köprü, `opencode api post /api/experimental/generate` çağrısıyla yerel
  OpenCode servisine bağlanır; **API anahtarı uygulamada saklanmaz** (kimlik
  bilgisini CLI yönetir). Çağrı Windows'ta güvenli olsun diye argüman listesiyle
  yapılır ve **doğrudan `opencode.exe`** kullanılır — `opencode.cmd` batch
  sarmalayıcısı JSON'daki `%`/`&` karakterlerini cmd.exe'de parçaladığı için
  yalnızca son çaredir (düşme şablon/OpenAI zincirine olur).
- `status` yanıtında `llm_enabled` + `llm_model` görünür; panelde
  "LLM gerekçe · opencode/google/gemini-3.8-flash" olarak gösterilir.
- Eski `OPENAI_API_KEY` yolu aynen korunur (köprü düşerse yedek).

---

## 12. Kendi sunucuna taşıma

1. Sunucuya Docker + Docker Compose kur.
2. Repo'yu kopyala → `cp .env.example .env` → değerleri düzenle
   (Telegram, DB, bakiye, ücretler).
3. `docker compose up -d --build`
4. Güvenlik: paneli doğrudan internete açma; reverse proxy (Caddy/Nginx) +
   basic-auth veya VPN arkasına koy. CORS varsayılan `*` (panelini kendi
   sitene gömerken gerekir); kısıtlamak istersen `main.py`'deki
   `allow_origins` listesini daralt.
5. SQLite → PostgreSQL: `DATABASE_URL` değiştir, eski `data/paperbot.db`
   verisini taşımak istersen `pgloader` kullan.
6. Yedekleme: `data/` + `logs/` dizinleri tüm durumu tutar; cron ile kopyala.
7. Dışa aktarım: paneldeki CSV/JSON bağlantıları veya
   `/api/export/*` uçları (otomasyon için ideal).

---

## 13. Testler

```powershell
pytest -q
# 192 test: motor maliyet modeli, SL/TP, limitler, kill switch,
# risk filtresi, karar mantığı, metrikler, backtest, REST API,
# çok zaman dilimli analiz (Faz 9), Binance canlı yürütme (Faz 10),
# OpenCode LLM köprüsü (Faz 11)
```

Testler ağ erişimi olmadan koşar (mock fiyat kaynağı kullanılır).

---

## Yol haritası (onayınla ilerler)

- **Faz 1 (bu sürüm)** ✅ sanal motor + dashboard + backtest + API
- **Faz 2** ✅ on-chain & akıllı para: cüzdan portföy çekimi (mock/Etherscan),
  hareket farkı → sinyal, çoklu cüzdan birikimi (≥2 = güçlü), cüzdan türü
  filtreleri (borsa/ekip/MM hariç), geçmiş isabet oranı → skor çarpanı,
  `/api/smart-money` + panel Cüzdanlar sekmesi
- **Faz 3** ✅ DeFi metrikleri (DefiLlama, anahtarsız): 4 bileşenli katman —
  **TVL trendi** (%30, 7g+1g değişim), **TVL derinliği** (%25, log ölçek),
  **ücret geliri** (%25, günlük gelir + değişim ayarı), **APY getirisi** (%20,
  aşırı APY cezalı eğri — %20 üzeri "sürdürülemez" notu). Majörler zincir
  rotasıyla (`/v2/chains` + geçmiş TVL), DeFi tokenları protokol rotasıyla
  (`/protocols` + `summary/fees`) çözülür; eşleşme yoksa deterministik mock,
  alan yoksa `na` politika skoru. Gerekçede "DeFi kanıtı" satırı,
  `/api/defi/{symbol}` + panelde DeFi hücresi tooltip'i, `DEFI_SOURCE`
  anahtarı (`auto|live|mock|off`) → `paperbot/core/defi.py`,
  `paperbot/data/defi.py`
- **Faz 4** ✅ risk & güvenlik: DefiLlama denetim kaydı + hack geçmişi
  (tutar/yakınlık/iade), GoPlus kontrat kontrolü (honeypot, sahip yetkileri,
  vergi, sahiplik yoğunluğu), protokol yaşı → **kritik tavanlar** (honeypot/
  taze büyük hack skoru tavanlar → risk veto'su kesinleşir), gerekçede
  "Güvenlik kanıtı" satırı, `/api/risk/{symbol}` + panelde risk hücresi
  tooltip'i → `paperbot/core/risk.py`, `paperbot/data/security.py`
  - Yaş kaynağı sırası: DefiLlama listeleme → bilinen ağ doğuşu → ilk
    hallmark (yaş alt sınırı) → yoksa muhafazakâr `na` → mock. Veri
    uydurulmaz, her bileşen `live|mock|na` etiketi taşır.
  - GoPlus ücretsiz limiti: 4 sn aralık + **8 istek/dakika bütçesi** +
    `4029` yanıtında 60 sn soğuma. Bütçe/soğuma aşan istek o çevrimde
    atlanır ve **sonraki çevrimde otomatik denenir** (sistem hiç
    kilitlenmez; kalan bileşenler geçici olarak `mock` etiketli kalır).
  - EVM olmayan adresler (ör. DefiLlama'ın AVAX için verdiği X-chain
    base58 adresi) GoPlus'a sorulmaz → `na` etiketli politika skoru.
- **Faz 5** ✅ duygu & haber: 3 bileşenli katman — **Korku&Açgözlülük** (%40,
  alternative.me endeksi; denge bölgesinde zirve yapan eğri + 7g momentum ±6),
  **Haber akışı** (%35, Google News RSS `when:1d` varlık ADIyla sorgulanır →
  başlıklarda sözlük duygu: pozitif/negatif kelime dengesi; haber yoksa canlı
  "sakin" skoru), **Dikkat** (%25, CoinGecko trend listesi — varlık trendte
  mi). Üçü de **anahtarsız**; gerekçede "Duygu kanıtı" satırı,
  `/api/sentiment/{symbol}` + panelde duygu hücresi tooltip'i,
  `SENTIMENT_SOURCE` anahtarı (`auto|live|mock|off`) →
  `paperbot/core/sentiment.py`, `paperbot/data/sentiment.py`
- **Faz 6** ✅ makro: 4 bileşenli katman — **Likidite** (%40, DefiLlama
  stablecoin arzı 7g/30g değişimi: arz büyürse likidite giriyor),
  **Piyasa momentumu** (%25, CoinGecko toplam piyasa 24s değişim),
  **BTC dominansı** (%20, denge eğrisi: 48-62% sağlıklı rejim zirve,
  aşırı alt-sezon/btc-kaçışı cezalı), **Dolar gücü** (%15, ECB EUR/USD
  7g/30g — USD güçleniyorsa kripto üzerinde baskı). Üçü de **anahtarsız**;
  gerekçede "Makro kanıtı" satırı, `/api/macro/{symbol}` + panelde makro
  hücresi tooltip'i, `MACRO_SOURCE` anahtarı (`auto|live|mock|off`) →
  `paperbot/core/macro.py`, `paperbot/data/macro.py` (Fed takvimi için
  anahtarsız kaynak bulunamadı — ileride anahtarla eklenebilir)
- **Faz 7** ✅ LLM gerekçe üretimi: `OPENAI_API_KEY` girildiğinde motor
  (adım 8) yalnızca **aksiyon üreten** kararlarda (`open|exit|risk_block`)
  şablon gerekçenin altına `[LLM yorumu]` bloğu ekler — olasılık dilinde,
  yatırım tavsiyesi vermeyen, "sanal test" uyarılı prompt. Anahtar yoksa,
  hata/timeout olursa veya yanıt 200 değilse şablon aynen kalır (karar,
  skor veya risk asla LLM'den etkilenmez) → `refine_with_llm`
  (`paperbot/core/decision.py`), `tests/test_llm.py` · panelde
  `OPENAI_API_KEY` alanı + `llm_enabled` durumu
- **Faz 8** ✅ **Akıllı TP/SL** (varlık bazlı dinamik hedef): `STOP_LOSS_PCT` /
  `TAKE_PROFIT_PCT` artık **taban** değer — girişte dört faktörle
  ölçeklenir: **volatilite** (teknik katman `vol_pct`, referans %2.5/gün),
  **güven** (karar güveni), **balina sinyali** (on-chain akıllı para:
  birikim/dağıtım/güçlü) ve **risk seviyesi** (yüksek risk → sıkı hedef).
  Disiplin: TP %6–%35 arası, SL %4–%12 arası **ve** TP'nin %40–%60'ında
  (R:R ≥ ~1.5). Açık pozisyonda TP her döngüde **yalnızca yukarı** revize
  edilir (kazanç bırakma; aşağı çekilmez). Giriş gerekçesine şeffaf
  `Akıllı TP/SL: TP +%X / SL -%Y (faktörler…)` satırı eklenir, kararla
  birlikte DB'ye saklanır → `paperbot/core/adaptive.py`,
  `paper_engine.py` (giriş + revizyon), `adaptive_tp` ayarı +
  `ADAPTIVE_TP` env, panelde onay kutusu, `tests/test_adaptive.py`
  (14 test; toplam **168**)
- **Faz 9** ✅ **Çok zaman dilimli analiz**: teknik katman artık 4 mum
  diliminden puan üretir — **4h %45** (giriş zamanlaması), **1d %30**
  (ana teyit), **1w %15 + 1M %10** (genel yön / uzun vade trendi).
  Gerekçede `genel_yon` (yukarı/aşağı/nötr) ve `agirliklar` detayı var;
  backtest AYNI ağırlıkları kullanır (uzun TF'ler pencere ötesi tarihçeyle
  gerçek zaman damgasından hizalanır, lookahead yok) →
  `paperbot/core/scoring.py` (`TechnicalLayer`), `paperbot/core/backtest.py`
  (`TECH_TF_PLAN`, `_tf_visibility`), `paperbot/data/pricefeed.py`
  (`1w`/`1M` klines), `tests/test_multitf.py`
- **Faz 10** ✅ **Binance canlı işlem (gerçek para)**:
  `BinanceExecutionProvider` — spot **piyasa emirleri** (alış
  `quoteOrderQty` ile, satış LOT_SIZE adımına yuvarlanır ve bakiyeyi
  aşmaz), ücretler `fills`'ten hesaplanır, gas 0. Çift emniyet kilidi:
  `TRADING_MODE=live` **ve** `LIVE_TRADING_ENABLED=true` **ve** anahtarlar
  mevcut değilse asla emir gitmez (`ExecutionDisabled` → "reddedildi").
  Her çevrimde bakiye borsadan senkronlanır; senkron başarısızsa yeni
  girişler o çevrimde durur. **Mod geçişleri** (paper↔live) sanal
  sağlayıcıyla yapılır (karşı tarafta yanlış gerçek emir gitmez); canlı→
  kağıt dönüşünde gerçek varlıklar SATILMAZ, panel uyarı verir.
  Backtest her koşulda paper'a zorlanır. Anahtarlar panelden girilir →
  Binance'te doğrulanır → **yalnızca `.env`'ye** yazılır (DB'ye asla);
  paneldeki "Binance API & Canlı İşlem" kartı + `/api/binance/*` uçları,
  alt bilgi uyarısı moda göre değişir → `paperbot/core/binance_exec.py`,
  `paperbot/config.py` (`write_env_vars`), `tests/test_binance_exec.py`
  (toplam **186**)
- **Faz 11** ✅ **LLM gerekçe köprüsü (OpenCode)**: OpenAI kredisi
  tükendiğinde karar gerekçeleri kesintisiz üretilir — `LLM_BRIDGE=opencode`
  ile yerel OpenCode API'si (`/api/experimental/generate`) köprülenir; model
  seçimi `LLM_PROVIDER`/`LLM_MODEL`/`LLM_VARIANT` (varsayılan
  `google/gemini-3.8-flash` **high**, ücretsiz `opencode/space-bunny-free`
  alternatifi). **Zincir:** OpenCode → OpenAI (anahtar varsa) → şablon;
  hiçbir bağlantı yoksa karar asla etkilenmez. CLI argüman listesiyle
  çağrılır (Windows quoting güvenli), varyant desteklemeyen modelde
  varyantsız otomatik tekrar, `status.llm_model` + panel
  "LLM gerekçe · opencode/…" göstergesi → `paperbot/core/llm.py`,
  `paperbot/core/decision.py`, `tests/test_llm_opencode.py`
  (toplam **192**)
