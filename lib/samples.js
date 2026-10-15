// Example alerts. Customer, account and transaction IDs match the core-banking
// data the workflow's lookup step returns, so each one produces a full case.
'use strict';

const SAMPLES = [
  {
    key: 'structuring',
    title: 'Example A · Structuring and offshore wires',
    expect: 'Expected: escalated to the SAR team',
    expectTone: 'bad',
    customer: 'Viktor Petrov · CUS-1001',
    desc: 'Viktor Petrov (CUS-1001) · rule TM-003 · score 87. Twelve cash deposits just under USD 10,000, then wires to the UAE and Cyprus.',
    alert: {
      alert_id: 'ALT-2026-00147',
      generated_at: '2026-04-02T14:23:00Z',
      rule_code: 'TM-003',
      score: 87,
      priority: 'H',
      subject_account: 'ACC-1001-CHK',
      narrative: 'Structuring alert generated for account ACC-1001-CHK held by PETROV, VIKTOR (CUS-1001). 12 cash deposits totaling USD 108,500 between 2026-03-18 and 2026-03-31, individual amounts ranging $8,000-$9,500. Deposits across branches BR-NYC-001, BR-NYC-002, BR-NYC-003, BR-NYC-004. Related entity: PETROV GLOBAL TRADE LTD (business account ACC-1001-BIZ). Subsequent outbound wires to UAE and Cyprus detected. Prior alerts: none.',
      flagged_txns: 'TXN-A001,TXN-A002,TXN-A003,TXN-A004,TXN-A005,TXN-A006,TXN-A007,TXN-A008,TXN-A009,TXN-A010,TXN-A011,TXN-A012,TXN-A013,TXN-A014,TXN-A015',
      related_accounts: 'ACC-1001-BIZ',
      system: 'TM-Engine-v4.2',
    },
  },
  {
    key: 'large-wire',
    title: 'Example B · Large cross-border wire',
    expect: 'Expected: closed as a false positive',
    expectTone: 'ok',
    customer: 'Sarah Chen · CUS-2001',
    desc: 'Sarah Chen (CUS-2001) · rule TM-011 · score 41. One AUD 45,000 wire to her own account in New Zealand for a property settlement.',
    alert: {
      alert_id: 'ALT-2026-00152',
      generated_at: '2026-04-02T09:05:00Z',
      rule_code: 'TM-011',
      score: 41,
      priority: 'M',
      subject_account: 'ACC-2001-CHK',
      narrative: 'Large outbound wire alert generated for account ACC-2001-CHK held by CHEN, SARAH (CUS-2001). Single outbound wire of AUD 45,000 on 2026-04-01 to New Zealand (ANZ Bank NZ), beneficiary name matches account holder, reference "Property settlement - Auckland apartment". Amount exceeds 5x the customer\'s average monthly outflow. Regular salary credits from TechCorp Pty Ltd. Prior alerts: none.',
      flagged_txns: 'TXN-B001',
      related_accounts: 'ACC-2001-SAV',
      system: 'TM-Engine-v4.2',
    },
  },
  {
    key: 'cash-velocity',
    title: 'Example C · Rising cash deposits',
    expect: 'Expected: referred to L2 investigation',
    expectTone: 'warn',
    customer: 'Mohammed Al-Hassan · CUS-3001',
    desc: 'Mohammed Al-Hassan (CUS-3001) · rule TM-007 · score 62. Restaurant cash deposits up about 40%, three round USD 5,000 deposits, one wire to Lebanon.',
    alert: {
      alert_id: 'ALT-2026-00158',
      generated_at: '2026-04-01T16:40:00Z',
      rule_code: 'TM-007',
      score: 62,
      priority: 'M',
      subject_account: 'ACC-3001-BIZ',
      narrative: 'Cash velocity alert generated for business account ACC-3001-BIZ held by AL-HASSAN, MOHAMMED (CUS-3001), owner of Al-Hassan Mediterranean Cuisine (restaurant). Cash deposits rose about 40% month on month: USD 22,500 in March 2026 versus USD 14,100 in February 2026, including three round-amount deposits of USD 5,000. One outbound wire of USD 8,500 to Lebanon on 2026-03-25 referenced as family support. Prior alerts: none.',
      flagged_txns: 'TXN-C001,TXN-C002,TXN-C003,TXN-C004,TXN-C005,TXN-C006,TXN-C007',
      related_accounts: 'ACC-3001-CHK',
      system: 'TM-Engine-v4.2',
    },
  },
];

module.exports = { SAMPLES };
