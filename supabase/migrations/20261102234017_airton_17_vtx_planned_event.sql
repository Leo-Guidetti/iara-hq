create or replace view airton.v_tx with (security_invoker = true) as
SELECT t.id, t.user_id, t.account_id, t.date, t.amount, t.currency, t.fx_rate_brl, t.share_pct, t.amount_brl, t.description, t.merchant,
    t.category_id, t.kind, t.installment_n, t.installment_total, t.source, t.source_ref, t.cat_source, t.cat_confidence, t.reviewed,
    t.notes, t.created_at, t.updated_at,
    COALESCE(p.id, c.id) AS top_category_id,
    COALESCE(p.name, c.name) AS top_category_name,
    COALESCE(p.color, c.color) AS top_category_color,
    c.name AS category_name,
    COALESCE(p.nature, c.nature, CASE t.kind WHEN 'income'::text THEN 'renda'::text WHEN 'transfer'::text THEN 'transferencia'::text ELSE 'variavel'::text END) AS nature,
    (COALESCE((t.installment_total)::integer, 0) > 1) AS is_installment,
    CASE WHEN (t.kind = ANY (ARRAY['expense'::text, 'refund'::text])) THEN (- t.amount_brl) ELSE (0)::numeric END AS spend,
    t.planned_event_id,
    c.income_type
   FROM ((airton.transactions t
     LEFT JOIN airton.categories c ON ((c.id = t.category_id)))
     LEFT JOIN airton.categories p ON ((p.id = c.parent_id)));;
