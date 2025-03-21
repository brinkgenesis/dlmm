# Meteora DLMM Liquidity Management Bot

## Introduction

This bot automates liquidity management in Meteora's Dynamic Liquidity Market Maker (DLMM) pools to maximize fee collection and mitigate impermanent loss. It provides professional-grade risk management and implements multiple liquidity provision strategies for optimized returns.

## Key Features

- **Multiple Liquidity Strategies**:
  - Single-Sided SOL (BidAskImBalanced) for asymmetric exposure
  - Balanced Spot Strategy for market making
  - Automatic strategy selection based on market conditions

- **Advanced Risk Management**:
  - Circuit breakers for drawdown protection (15% threshold)
  - Position value tracking with real-time valuation
  - Volume monitoring with 6-hour moving average
  - Emergency exit protocols for market disruptions

- **Multi-Pool Support**:
  - Cross-pool position discovery and initialization
  - Unified position data handling
  - Automated fee claiming and compounding

- **Order Management System**:
  - Limit, Take Profit, and Stop Loss orders
  - Atomic multi-order execution
  - 60-second price monitoring interval

- **Performance Analytics**:
  - Fee APY calculations
  - Position P&L tracking
  - Impermanent loss monitoring
  - Exposure management across pools

- **Jupiter Price Integration**:
  - Real-time token price data
  - Multi-token batch requests
  - USD value calculation

## Implementation Status

| Component | Status | Description |
|-----------|--------|-------------|
| Order Management | ✅ Complete | Full order execution with limit/TP/SL |
| Position Creation | ✅ Complete | Creation with proper strategy implementation |
| Risk Management | ✅ Complete | Circuit breakers, drawdown detection |
| Auto-Compounding | ✅ Complete | Automated fee claiming and reinvestment |
| Market Selection | ✅ Complete | API for market discovery and filtering |
| Position Tracking | ✅ Complete | Performance monitoring and valuation |
| Delegation System | 🛠 Partial | Basic structure implemented, needs completion |
| Volatility Response | ❌ Planned | Not yet implemented (Priority 5) |
| Token Vetting | 🛠 Partial | Basic confidence scoring (Priority 4) |
| Alerting System | ❌ Planned | Not yet implemented (Priority 1) |

## Requirements

- Node.js 16+ and npm
- Solana CLI tools
- Access to RPC node (preferably dedicated)
- Wallet with sufficient SOL for transactions

## Setup

### 1. Clone the repository

```bash
git clone https://github.com/yourusername/meteora-dlmm-bot.git
cd meteora-dlmm-bot
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment variables

Create a `.env` file in the root directory:

```