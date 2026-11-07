# High-Frequency Quantitative Market Maker (Python 3.10+ AsyncIO)

Production-grade, low-latency automated Market Maker (MM) bot designed for algorithmic cryptocurrency trading on CEX/DEX platforms. The bot operates continuously on real-time L2/L3 order book depth, tick-level trade execution streams, and micro-timeframe momentum indicators.

---

## 🏛 3-Pillar Architectural Loop

The engine operates on a strict, decoupled 3-pillar loop executing every **~100ms**:

```
 ┌───────────────────────────────────────────────────────────────┐
 │                   EXCHANGE WEBSOCKET & REST                   │
 └───────────────────────────────┬───────────────────────────────┘
                                 │ Real-time ticks & depth
                                 ▼
 ┌───────────────────────────────────────────────────────────────┐
 │                     LOCAL ORDER BOOK (L2)                     │
 │      Top-5 depth scanning, LTP tracking & order imbalance     │
 └───────┬───────────────────────────────────────────────┬───────┘
         │                                               │
         ▼                                               ▼
 ┌───────────────────────┐                       ┌───────────────┴───────────────┐
 │   PILLAR C: RISK &    │                       │     PILLAR A: PRICING &       │
 │   INVENTORY MANAGER   │                       │     TREND DEFENSE ENGINE      │
 │ • Capital allocations │                       │ • Dynamic spread tightening   │
 │ • Feed stale tripwire │────── Inventory ─────▶│ • Trend leaning (Up/Down)     │
 │ • Drawdown stop-loss  │        Skew           │ • Flash pump/dump perimeter   │
 │ • Pre-trade validation│                       │ • Micro-lot ladder generation │
 └───────────────────────┘                       └───────────────┬───────────────┘
                                                                 │
                                                                 ▼ Target Quotes
 ┌───────────────────────────────────────────────────────────────┴───────────────┐
 │                  PILLAR B: ASYNC ORDER MANAGER                                │
 │ • Cancel-Replace diffing (prevents API spam)                                  │
 │ • Partial/full fill state reconciliation                                      │
 │ • Rate-limit exponential backoff                                              │
 │ • Atomic emergency cancel-all on shutdown (SIGINT/SIGTERM)                    │
 └───────────────────────────────────────────────────────────────────────────────┘
```

---

## 📦 Directory Structure

```
/bots/python_hft_mm/
├── .env.example         # Template for exchange credentials and quantitative parameters
├── requirements.txt     # AsyncIO dependencies (aiohttp, websockets, python-dotenv)
├── config.py            # Immutable config container and strict Decimal precision engine
├── orderbook.py         # Local L2 synchronized memory book, LTP tracker & Top-5 scanner
├── trend_defense.py     # Micro-timeframe EMA momentum & Anti-Pump/Dump flash defense
├── pricing_engine.py    # Pillar A: Dynamic spread tightening, trend leaning & ladders
├── risk_manager.py      # Pillar C: Inventory ceilings, websocket tripwires & drawdowns
├── order_manager.py     # Pillar B: Asynchronous order lifecycle & cancel-replace diffing
├── client_ws.py         # WebSocket market listener + HMAC-SHA256 authenticated REST client
├── main.py              # Main runtime loop orchestrator with OS signal trap
└── README.md            # Comprehensive algorithmic and architectural documentation
```

---

## ⚡ Key Quantitative Modules & Specifications

### 1. Target Environment & Configuration (`config.py`)
- **Strict Decimal Precision Math**: Eliminates binary floating-point rounding errors (`0.1 + 0.2 != 0.3`).
- **Asset Precision**:
  - Base Token: **8 decimals** (Atomic unit scale: $10^8$).
  - Quote Asset (USDT): **6 decimals** (Atomic unit scale: $10^6$).
- **Tick & Lot Size Quantization**: Automatically rounds prices to exchange tick intervals (`ROUND_HALF_UP` for asks, `ROUND_DOWN` for bids) and clips order volumes to lot sizes.

### 2. Real-Time Order Book Analysis (`orderbook.py`)
- Maintains synchronized local memory hash tables (`_bids` and `_asks`) updated via WebSocket deltas.
- Scans the **Top 5 Bid/Ask levels** before every calculation:
  - Best Bid / Best Ask / Mid-Price / Absolute Spread / Spread Percentage.
  - Aggregated Top-5 Bid Liquidity vs Ask Liquidity.
  - Micro-order imbalance metric: $\frac{\text{Bid Liq} - \text{Ask Liq}}{\text{Bid Liq} + \text{Ask Liq}} \in [-1.0, 1.0]$.
- Continuous **Last Traded Price (LTP)** tracking from real-time trade execution feeds.

### 3. Dynamic Spread Tightening & Micro-Lot Sizing (`pricing_engine.py`)
- **Spread Tightening**:
  - When the market spread exceeds 2 ticks, the bot steps **1 tick inside** the best bid and ask to capture the inside spread and claim queue priority.
  - When the spread is tight (1-2 ticks), the bot joins the best bid/ask to avoid crossing the book.
- **Micro-Lot Sizing**:
  - Places minimal lot quantities (`MICRO_ORDER_SIZE`, e.g., 0.001 BTC) during normal conditions to maintain constant liquidity presence without risking massive capital.

### 4. Trend-Following & Anti-Manipulation Module (`trend_defense.py`)
- **Micro-Timeframe Trend Detection**:
  - Evaluates tick-level trades through dual Exponential Moving Averages (Fast EMA $\alpha_{12}$ vs Slow EMA $\alpha_{36}$).
  - Computes volume-weighted price momentum.
- **Directional Trend Leaning**:
  - **Uptrend**: Leans quotes upward (shifts bid and ask higher by up to +15 bps). This supports the market rally while shielding the Ask side from adverse selection.
  - **Downtrend**: Drops replacement bids lower by up to -15 bps to prevent "catching a falling knife".
- **Anti-Manipulation / Flash Defense (Pump & Dump Protection)**:
  - Monitors short-term price variance and rolling volume spikes ($> 2.5\times$ rolling average or volatility $> 120$ bps).
  - When a pump or dump is detected:
    1. **Suspends aggressive inside quotes**.
    2. **Widens defensive perimeter** by $3.0\times$ standard spread.
    3. **Scales lot sizes down to micro-fractions** (20% of standard size).
    4. **Places a maximum of 2-3 laddered orders** at structural support/resistance blocks.

### 5. Robust Risk & Order Management (`risk_manager.py` & `order_manager.py`)
- **Inventory Mean-Reversion Skew**:
  - If base token holdings exceed target inventory, quotes are skewed downward to encourage selling and discourage buying.
- **WebSocket Staleness Tripwire**:
  - If the market WebSocket feed goes silent for $> 4.0\text{ seconds}$, the bot immediately **cancels all open orders** and pauses quoting until fresh data arrives.
- **Peak Drawdown Circuit Breaker**:
  - Continuous tracking of mark-to-market equity. If drawdown from peak exceeds `MAX_DRAWDOWN_PCT` (default 3.0%), all trading halts.
- **Cancel-Replace Diffing**:
  - Compares existing resting orders against newly calculated targets. Only cancels and replaces if the target has shifted by $\ge 1\text{ tick}$, eliminating unnecessary exchange rate-limit consumption.
- **Graceful Shutdown**:
  - OS signals (`SIGINT` Ctrl+C, `SIGTERM`) trigger an atomic `cancel_all()` before exiting.

---

## 🔐 How to Securely Connect Exchange API Keys

### Step 1: Prepare Environment File
Copy `.env.example` to `.env` in the bot directory:
```bash
cp /bots/python_hft_mm/.env.example /bots/python_hft_mm/.env
```

### Step 2: Configure API Credentials
Edit `.env` with your exchange credentials:
```env
EXCHANGE=DIMONEX
SYMBOL=BTC-USDT
BASE_ASSET=BTC
QUOTE_ASSET=USDT

WS_URL=ws://localhost:3000/ws/market
REST_URL=http://localhost:3000/api

API_KEY=your_production_api_key_here
API_SECRET=your_production_hmac_secret_here
```

### Step 3: Security Best Practices
1. **Never Commit API Secrets**: The `.env` file should remain strictly on the host and in `.gitignore`.
2. **Restrict API Key Permissions**:
   - Enable: **Spot Trading (Place / Cancel Order)**, **Read Account Balance**.
   - Disable: **Withdrawals / Transfers** (Market maker bots should NEVER have withdrawal permissions).
3. **IP Whitelisting**: Lock the API key to your server's static IP address in your exchange dashboard.
4. **HMAC-SHA256 Signing**: All REST requests in `client_ws.py` are signed on-the-fly with Unix millisecond timestamps:
   $$\text{Signature} = \text{HMAC-SHA256}(\text{Secret}, \text{Timestamp} + \text{QueryString} + \text{Body})$$
   This prevents replay attacks.

---

## 🚀 Running the Bot

### 1. Install Dependencies
```bash
python3 -m venv venv
source venv/bin/activate
pip install -r /bots/python_hft_mm/requirements.txt
```

### 2. Launch the Bot
```bash
python3 /bots/python_hft_mm/main.py
```

### 3. Live Terminal Dashboard Output
```
15:40:02 [INFO] [HFT-MM] Initializing Quantitative HFT Market Maker for pair: BTC-USDT
15:40:02 [INFO] [HFT-MM] Target Spread: 0.08% | Micro-lot: 0.001 BTC
15:40:02 [INFO] [HFT-MM] Precision: Base=8 dec, Quote=6 dec
15:40:03 [INFO] [ExchangeClient] WebSocket connected successfully. Subscribing to orderbook and trades...
15:40:03 [INFO] [HFT-MM] Entering 3-Pillar Quantitative Loop (100ms cycle)...
15:40:04 [INFO] [OrderManager] Placed BUY L1 @ 64520.10 | Qty: 0.0010
15:40:04 [INFO] [OrderManager] Placed SELL L1 @ 64521.50 | Qty: 0.0010
15:40:08 [INFO] [HFT-MM] [STATUS] LTP: 64520.8000 | Spread: 0.022% | Trend: UPTREND (Skew: 6 bps) | Flash Defense: OFF | Active Orders: 2 | Inv Skew: 0.05 | Drawdown: 0.00%
```
