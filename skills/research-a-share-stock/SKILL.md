---
name: research-a-share-stock
description: Research and analyze a specific A-share stock. Use when the user asks Codex to study, research, investigate, evaluate, or judge one listed company or stock, including requests for fundamentals, industry position, financial reports, official announcements, investor-interaction answers, broker research, news, investor sentiment, investment value, risks, or a final view based on collected evidence.
---

# Research A-share Stock

## Overview

Use this skill to research one A-share stock according to the saved research specification, then produce a sourced report and a clear judgment. Treat the result as research analysis, not personalized investment advice.

## Required Reference

Always read `references/stock_research_spec.md` before collecting information. This file is the authoritative, user-editable research spec and may be incrementally modified over time.

## Workflow

1. Identify the target stock.
   - If the user gives only a company name or ambiguous short name, resolve the stock code, exchange, and official company name before analysis.
   - If multiple listed companies match, ask the user to choose.
2. Read `references/stock_research_spec.md` and follow its priority order.
3. Use current web sources for market, financial, announcement, news, and sentiment information. Do not rely on memory for current facts.
4. Prefer primary sources for high-weight evidence:
   - official company website and investor-relations pages;
   - official announcements and financial reports from CNINFO, SSE, SZSE, BSE, or the company;
   - official investor-interaction platforms: 上证e互动 or 深交所互动易.
5. Use secondary sources to complete the picture:
   - broker research reports, preferably at least 3 recent mainstream reports when available;
   - reputable business/news sources listed in the spec;
   - investor communities only as low-weight sentiment evidence.
6. Track every material claim to a source URL and publication/report date.
7. Separate confirmed facts, analyst interpretation, market sentiment, and your own judgment.
8. End with a judgment that includes valuation/investment value, key positives, key risks, confidence level, and what evidence would change the view.

## Report Shape

Use a concise but complete structure:

1. **结论先行**: one-paragraph view, confidence level, and time horizon.
2. **公司与业务**: main business, market focus, high-impact new businesses.
3. **行业与竞争**: industry trend, A-share sub-sector, recent sector performance, direct competitors, company position and moat.
4. **财务与估值**: latest 4 complete reports when available; revenue,扣非盈利, gross profit, net margin, PE, PEG, and trend.
5. **官方与互动信息**: company website, announcements, investor relations, interaction-platform answers.
6. **研报与新闻**: recent broker views and material news.
7. **投资者情绪**: Eastmoney/Xueqiu or similar community tone, clearly marked as low-weight evidence.
8. **综合判断**: positives, negatives, uncertainty, investment value, and practical watchpoints.
9. **Sources**: list important URLs with dates.

## Judgment Rules

- Give a direct judgment, but avoid absolute buy/sell commands.
- State whether the stock currently looks high, medium, or low investment value under the user's spec.
- Explain the evidence weight: official/financial information > company website > investor interaction > broker research > news > community sentiment.
- Call out missing data, stale data, paywalled reports, or unverified claims.
- If financial statements or recent reports cannot be sourced, do not infer them from stale summaries.
- Include explicit dates for reports, announcements, and news because this domain changes quickly.

## Source Quality

Use official sources first for filings, financial data, investor relations, and company claims. For news and broker reports, prefer recent, attributable sources; avoid unsourced reposts. Treat investor-community posts as sentiment only, not factual evidence unless independently verified.
