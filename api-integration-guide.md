# API Integration Guide for Meteora DLMM Frontend

This document maps backend API endpoints to corresponding frontend components to facilitate API integration in the dashboard.

## 1. API Endpoints Overview

```typescript
// Server endpoints from server.ts
POST /api/orders                     // Submit new order
POST /api/config                     // Configure auto-claim/auto-compound
GET  /api/positions                  // Get all positions with detailed data
GET  /api/positions/summary          // Get aggregated position statistics
POST /api/emergency/close-all-positions // Emergency close all positions
GET  /api/markets                    // Get available markets
POST /api/markets/select             // Create position in selected market
POST /api/wallet/connect             // Connect wallet (get challenge)
POST /api/wallet/verify              // Verify wallet signature
POST /api/wallet/delegate            // Delegate authority to bot
```

## 2. Data Structure Reference

### Position Summary Response (`/api/positions/summary`)

```typescript
interface PositionSummaryResponse {
  success: boolean;
  data: {
    totalPositions: number;
    inRange: number;
    outOfRange: number;
    nearEdge: number;
    totalValue: number;
    totalChangeValue: number;
    walletValue: {
      totalValue: number;
      solBalance: number;
      solValue: number;
      tokens: {
        mint: string;
        balance: number;
        value: number;
      }[];
    };
    totalCapital: number;
  };
}
```

### Positions Data Response (`/api/positions`)

```typescript
interface PositionsResponse {
  success: boolean;
  data: {
    totalPositions: number;
    inRange: number;
    outOfRange: number;
    nearEdge: number;
    totalValue: number;
    totalChangeValue: number;
    positions: {
      publicKey: string;
      minBinId: number;
      maxBinId: number;
      originalActiveBin: number;
      currentActiveBin?: number;
      percentageThroughRange?: number;
      status?: 'IN_RANGE' | 'OUT_OF_RANGE' | 'NEAR_EDGE';
      poolAddress?: string;
      tokenXSymbol?: string;
      tokenYSymbol?: string;
      currentValue?: number;
      percentageChange?: number;
      pendingFeesUSD?: number;
      feeXAmount?: number;
      feeYAmount?: number;
      dailyAPR?: number;
      tokenXAmount?: number;
      tokenYAmount?: number;
      tokenXValue?: number;
      tokenYValue?: number;
      baseFeeRate?: number;
      startingPositionValue?: number;
    }[];
  };
}
```

### Markets Response (`/api/markets`)

```typescript
interface MarketsResponse {
  success: boolean;
  markets: {
    id: string;
    name: string;
    risk: string;
    fee: string;
    dailyAPR: string | number;
  }[];
}
```

## 3. Component to API Mapping

### `Dashboard.tsx`
- Main container for all dashboard components
- No direct API calls needed here, but it should orchestrate data fetching for child components

### `OverviewCard.tsx`
- **Primary API**: `GET /api/positions/summary`
- **Data elements**:
  - Current Balance: `data.totalValue` + `data.walletValue.totalValue`
  - Real-Time P&L: `data.totalChangeValue`
  - Summary section:
    - Total Deposited: Can be calculated from `totalValue - totalChangeValue`
    - Total Earned: `data.totalChangeValue` (if positive)
    - Yield Earned (30D): Calculate from position data
    - Open Positions: `data.totalPositions`
    - Time Active: Not directly provided by API, may need to store locally

**Example API call**:
```typescript
const fetchSummary = async () => {
  try {
    const response = await fetch('/api/positions/summary');
    const data = await response.json();
    
    if (data.success) {
      // Update state with summary data
      setSummaryData(data.data);
    }
  } catch (error) {
    console.error('Error fetching summary:', error);
  }
};
```

### `PositionsCard.tsx`
- **Primary API**: `GET /api/positions`
- **Secondary API**: `POST /api/markets/select` (for "CREATE NEW POSITION" button)
- **Data elements**:
  - Position list with basic data for each position
  - "CREATE NEW POSITION" button redirects to `/selectmarket`

**Example API call**:
```typescript
const fetchPositions = async () => {
  try {
    const response = await fetch('/api/positions');
    const data = await response.json();
    
    if (data.success) {
      // Transform API data to match component's expected format
      const transformedPositions = data.data.positions.map(position => ({
        id: position.publicKey,
        tokenImage: getTokenImage(position.tokenXSymbol), // Helper function
        pairName: `${position.tokenXSymbol} / ${position.tokenYSymbol}`,
        currentValue: formatCurrency(position.currentValue),
        yieldEarned: position.dailyAPR ? `${(position.dailyAPR * 30).toFixed(0)}%` : 'N/A',
        showDetails: false
      }));
      
      setPositions(transformedPositions);
    }
  } catch (error) {
    console.error('Error fetching positions:', error);
  }
};
```

### `PositionCard.tsx`
- Uses position data from parent (`PositionsCard.tsx`)
- Handles expanding/collapsing to show details
- No direct API calls needed, data should be passed as props

### `PositionDetails.tsx`
- **Primary API**: Position data from `GET /api/positions` (specific position)
- **Secondary API**: `POST /api/orders` (for claiming fees or setting orders)
- **Data elements**:
  - Entry/Real-time Liquidity: `position.startingPositionValue` / `position.currentValue`
  - Token amounts: `position.tokenXAmount`, `position.tokenYAmount`
  - TVL: Not directly provided, need to add to API
  - Price: Calculate from position data
  - Volume/TVL Ratio: Not directly provided, need to add to API
  - Pool Strategy: Not directly provided (implied by position configuration)
  - Fees Unclaimed: `position.pendingFeesUSD`
  - Liquidity Allocation: Not directly provided, calculate from position value vs total value
  - Position Status: Derive from `position.status`
  - Risk Level: Derive from pool data
  - Projected Yield: Calculate from `position.dailyAPR`
  - Bin Range: `position.minBinId`, `position.maxBinId`

**Example Claim Fees Action**:
```typescript
const claimFees = async (positionId: string) => {
  try {
    // Claim fees is essentially an order of type TAKE_PROFIT with 100% closeBps
    const response = await fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        poolAddress: position.poolAddress,
        orderType: 'TAKE_PROFIT',
        triggerPrice: 0, // Immediate execution
        closeBps: 100,   // Claim all fees
      })
    });
    
    const data = await response.json();
    if (data.success) {
      // Handle successful fee claim
      // Refresh position data
    }
  } catch (error) {
    console.error('Error claiming fees:', error);
  }
};
```

## 4. Integration Tips

1. **Authentication Flow**:
   - First call `/api/wallet/connect` to get a challenge
   - Have user sign the challenge with their wallet
   - Send signature to `/api/wallet/verify` to get JWT token
   - Include JWT token in Authorization header for subsequent requests

2. **Polling Strategy**:
   - Poll `/api/positions/summary` every 30-60 seconds for updated overview data
   - Poll `/api/positions` every 60-120 seconds for full position updates
   - Consider implementing WebSocket for real-time updates if available

3. **Error Handling**:
   - All API responses include a `success` boolean
   - If `success` is false, check for `error` property with error message
   - Implement retry logic for transient errors
   - Show appropriate UI feedback for persistent errors

4. **Loading States**:
   - Implement skeleton loaders for initial data fetch
   - Use optimistic UI updates where appropriate (e.g., fee claiming)
   - Add loading indicators for actions (position creation, fee claiming)

5. **Data Transformation**:
   - Backend provides raw numeric values without formatting
   - Implement consistent formatting helpers for:
     - Currency formatting: `$1,234.56`
     - Percentage formatting: `+12.34%`
     - Token amount formatting: `1.23 SOL`

## 5. Implementation Sequence

1. Start with basic authentication flow
2. Implement `/api/positions/summary` for overview data
3. Implement `/api/positions` for detailed position data
4. Add position interaction features (fee claiming)
5. Implement position creation flow using `/api/markets` and `/api/markets/select`
6. Add configuration options with `/api/config`
7. Implement advanced features (orders, emergency functions)

## 6. Missing Data Points

The following data points are shown in the UI but may not be directly available from current API endpoints:

1. P&L chart data over time (historical data)
2. Time Active for positions
3. Detailed pool strategy information
4. Risk level categorization
5. Volume/TVL ratio per pool

Consider adding new endpoints or enhancing existing ones to provide this data. 