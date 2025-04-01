%% Mermaid diagram for DLMM Bot application flow (Server/TradingApp Architecture)

graph TD
    subgraph User/API Interaction
        U[User/Frontend] -- API Call --> SVR[server.ts (Express API)]
    end

    subgraph API Endpoints
        SVR -- /api/markets --> MS_API[Market Data Logic]
        SVR -- /api/markets/select --> MSC[Market Selection & Creation]
        SVR -- /api/positions --> DASH_API[Dashboard Logic]
        SVR -- /api/rebalance/check --> RB_API[Manual Rebalance Trigger]
        SVR -- /api/wallet/... --> AUTH_API[Wallet Auth/Delegation Logic]
        SVR -- /api/orders --> ORDER_API[Order Submission Logic]
        SVR -- /api/config --> CONFIG_API[Config Update Logic]
        SVR -- /api/emergency/... --> EMG_API[Emergency Close Logic]
    end

    subgraph Core Application
        APP[TradingApp (app.ts)]

        MSC --> APP
        DASH_API --> APP
        RB_API --> APP
        AUTH_API -- Creates/Manages? --> APP_USER[User-Specific TradingApp Inst?]
        ORDER_API --> APP
        CONFIG_API --> APP
        EMG_API --> APP

        APP -- Uses --> SEL[MarketSelector]
        APP -- Uses --> RB[RebalanceManager]
        APP -- Uses --> RM[RiskManager]
        APP -- Uses --> DASH[Dashboard]
        APP -- Uses --> OM[OrderManager Map]
        APP -- Uses --> PP[PassiveProcessManager]
        APP -- Uses --> STOR[PositionStorage]
        APP -- Uses --> CFG[Config]
        APP -- Uses --> CONN[Connection]
        APP -- Uses --> WLT[Wallet Keypair]
    end

    subgraph Managers & Services
        SEL -- Uses --> CONN
        SEL -- Uses --> WLT
        SEL -- Uses --> CFG
        SEL -- Uses --> STOR
        SEL -- Uses --> MKT_REPO[MarketRepository]
        SEL -- Uses --> POS_REPO[PositionRepository]
        SEL -- Uses --> JUP[fetchPriceJupiter]
        SEL -- Uses --> SWAP[swapTokens]
        SEL -- Uses --> CREATE_POS[createSingleSidePosition]

        RB -- Uses --> CONN
        RB -- Uses --> WLT
        RB -- Uses --> CFG
        RB -- Uses --> STOR
        RB -- Uses --> POS_REPO
        RB -- Uses --> JUP
        RB -- Uses --> CREATE_POS
        RB -- Uses --> SDK[DLMM SDK]

        RM -- Uses --> CONN
        RM -- Uses --> WLT
        RM -- Uses --> CFG
        RM -- Uses --> STOR
        RM -- Uses --> SDK

        DASH -- Uses --> CONN
        DASH -- Uses --> CFG
        DASH -- Uses --> STOR
        DASH -- Uses --> POS_REPO
        DASH -- Uses --> MKT_REPO
        DASH -- Uses --> JUP
        DASH -- Uses --> SDK
        DASH -- Uses --> METEORA_POS_API[Meteora Position API]

        OM -- Uses --> CONN
        OM -- Uses --> WLT
        OM -- Uses --> CFG
        OM -- Uses --> STOR
        OM -- Uses --> ORD_REPO[OrderRepository]
        OM -- Uses --> SDK
        OM -- Uses --> CREATE_POS

        PP -- Uses --> CONN
        PP -- Uses --> WLT
        PP -- Uses --> CFG
        PP -- Uses --> STOR
        PP -- Uses --> SDK
        PP -- Uses --> AC[AutoCompounder]

        AC -- Uses --> SDK
        AC -- Uses --> CREATE_POS
    end

    subgraph Data Layer
        STOR -- Syncs Via --> POS_REPO
        MKT_REPO -- Reads/Writes --> DB[(Supabase DB)]
        POS_REPO -- Reads/Writes --> DB
        ORD_REPO -- Reads/Writes --> DB
    end

    subgraph External Services
        MKT_REPO -- Reads --> METEORA_MKT_API[Meteora Market API]
        POS_REPO -- Reads --> METEORA_POS_API
        JUP -- Reads --> JUPITER_API[Jupiter Price API]
        SDK -- Interacts --> SOLANA[Solana Blockchain]
    end

    style SVR fill:#f9f,stroke:#333,stroke-width:2px
    style APP fill:#ccf,stroke:#333,stroke-width:2px
    style DB fill:#f8d7da,stroke:#721c24
    style SOLANA fill:#9cf,stroke:#333
    style External Services fill:#eee,stroke:#999