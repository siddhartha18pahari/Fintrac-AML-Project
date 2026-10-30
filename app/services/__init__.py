"""Domain services.

Each module owns one stage of the pipeline and is independently testable:

    valuation      CAD equivalence with reproducible, snapshotted rates
    aggregation    the 24-hour rule and threshold detection
    rules_engine   configurable, versioned AML indicators
    risk           behavioural baselines and explainable composite scoring
    anomaly        unsupervised outlier detection with ablation attributions
    graph_engine   transaction-network analytics
    case_service   alert triage, case lifecycle, the human decision path
    report_builder canonical reports built from case evidence
    fintrac_mapper canonical -> FINTRAC LVCTR JSON-LD
    validation     five-level report validation
    str_copilot    evidence-grounded STR narrative drafting
    mock_fintrac   simulated receiver and the submission service
    pipeline       ingestion and orchestration
    instruments    virtual-currency / cash / EFT classification
    fiat_rules     LCTR, EFTR, structuring and cross-rail indicators
    typology_rules sanctions, PEP, terrorist property, travel rule, trade, MSB, casino
    screening      fuzzy name matching against the bundled fictional list
    customer_risk  explainable inherent and residual customer rating
    link_analysis  shared wallet, device, IP and beneficiary clusters
    book_metrics   threshold replay series and labelled-scenario recall
    draft_filings  FINTRAC-like STR, LCTR, EFTR and TPR drafts
    knowledge_graph  customers, cases, alerts, rules, wallets, devices, parties
    retrieval      BM25 over bundled FINTRAC guidance summaries
    statistics     Benford, fences, isolation-style scores, ROC, decomposition
    book_simulator agent-based Canadian book, planted labels, rule scoring
    studio_data    snapshot queries shared with the Next.js studio API
    langchain_copilot  tool-calling chat with a deterministic fallback
"""
