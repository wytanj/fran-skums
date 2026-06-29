-- ============================================================
-- SKUMS — Skincare Intelligence: Seed Reference Data
-- Run AFTER: skincare-intelligence.sql
-- ============================================================

-- ── 1. Skincare Concerns Taxonomy (Hwahae-aligned) ──────────

INSERT INTO skincare_concerns (id, label, key_ingredients, sort_order) VALUES
  ('hydration',   'Hydration',    ARRAY['hyaluronic acid','glycerin','aloe vera','ceramide','beta-glucan','polyglutamic acid','sodium hyaluronate'], 1),
  ('soothing',    'Soothing',     ARRAY['centella asiatica','allantoin','panthenol','madecassoside','bisabolol','mugwort','calendula'], 2),
  ('brightening', 'Brightening',  ARRAY['vitamin c','ascorbic acid','arbutin','tranexamic acid','niacinamide','kojic acid','licorice root'], 3),
  ('anti_aging',  'Anti-Aging',   ARRAY['retinol','retinal','peptide','adenosine','collagen','PDRN','bakuchiol','NAD+'], 4),
  ('pore_care',   'Pore Care',    ARRAY['salicylic acid','niacinamide','clay','charcoal','witch hazel','zinc'], 5),
  ('acne',        'Acne/Blemish', ARRAY['salicylic acid','tea tree','benzoyl peroxide','sulfur','azelaic acid','centella'], 6),
  ('exfoliation', 'Exfoliation',  ARRAY['glycolic acid','lactic acid','mandelic acid','PHA','gluconolactone','enzyme','papain'], 7),
  ('moisturizing','Moisturizing',  ARRAY['shea butter','squalane','jojoba oil','ceramide','fatty acid','cholesterol','petrolatum'], 8)
ON CONFLICT (id) DO NOTHING;


-- ── 2. Ingredient Safety Reference ──────────────────────────

-- Tier 1: Gold Standard Actives
INSERT INTO ingredient_safety (inci_name, common_names, ewg_score, tier, function, concerns_addressed, trend, ips_bonus, is_hwahae_blacklisted) VALUES
  ('retinol',               ARRAY['Retinol','Vitamin A'],         3, 'tier1', 'active', ARRAY['anti_aging','acne','brightening','pore_care'], 'stable', 8, false),
  ('tretinoin',             ARRAY['Retinoic Acid','Retin-A'],     4, 'tier1', 'active', ARRAY['anti_aging','acne','brightening'], 'stable', 8, false),
  ('retinal',               ARRAY['Retinaldehyde'],               3, 'tier1', 'active', ARRAY['anti_aging','acne'], 'rising', 8, false),
  ('adapalene',             ARRAY['Differin'],                    4, 'tier1', 'active', ARRAY['acne'], 'stable', 7, false),
  ('zinc oxide',            ARRAY['Mineral Sunscreen'],           2, 'tier1', 'uv_filter', ARRAY['anti_aging'], 'rising', 6, false),
  ('titanium dioxide',      ARRAY['Mineral Sunscreen'],           2, 'tier1', 'uv_filter', ARRAY['anti_aging'], 'rising', 6, false),
  ('hydroquinone',          ARRAY['Skin Lightener'],              6, 'tier1', 'active', ARRAY['brightening'], 'stable', 5, false),
  ('benzoyl peroxide',      ARRAY['BPO'],                         5, 'tier1', 'active', ARRAY['acne'], 'stable', 7, false),
  ('salicylic acid',        ARRAY['BHA','Beta Hydroxy Acid'],     3, 'tier1', 'active', ARRAY['acne','pore_care','exfoliation'], 'stable', 7, false),
  ('ascorbic acid',         ARRAY['Vitamin C','L-Ascorbic Acid'], 3, 'tier1', 'active', ARRAY['brightening','anti_aging'], 'stable', 7, false),
  ('ascorbyl glucoside',    ARRAY['Stable Vitamin C'],            2, 'tier1', 'active', ARRAY['brightening','anti_aging'], 'stable', 6, false),
  ('azelaic acid',          ARRAY['Azelaic'],                     2, 'tier1', 'active', ARRAY['acne','brightening','soothing'], 'rising', 7, false),
  ('kojic acid',            ARRAY['Kojic'],                       3, 'tier1', 'active', ARRAY['brightening'], 'stable', 6, false),
  ('tranexamic acid',       ARRAY['TXA'],                         2, 'tier1', 'active', ARRAY['brightening'], 'rising', 7, false),
  ('glycolic acid',         ARRAY['AHA','Alpha Hydroxy Acid'],    4, 'tier1', 'active', ARRAY['exfoliation','brightening','acne'], 'stable', 6, false)
ON CONFLICT (inci_name) DO NOTHING;

-- Tier 2: Strong Evidence
INSERT INTO ingredient_safety (inci_name, common_names, ewg_score, tier, function, concerns_addressed, trend, ips_bonus, is_hwahae_blacklisted) VALUES
  ('niacinamide',           ARRAY['Vitamin B3','Nicotinamide'],    1, 'tier2', 'active', ARRAY['brightening','soothing','pore_care','moisturizing'], 'stable', 5, false),
  ('ceramide np',           ARRAY['Ceramide 3'],                   1, 'tier2', 'active', ARRAY['moisturizing','soothing'], 'rising', 5, false),
  ('ceramide ap',           ARRAY['Ceramide 6-II'],                1, 'tier2', 'active', ARRAY['moisturizing'], 'rising', 5, false),
  ('ceramide eop',          ARRAY['Ceramide 1'],                   1, 'tier2', 'active', ARRAY['moisturizing'], 'rising', 5, false),
  ('sodium hyaluronate',    ARRAY['Hyaluronic Acid','HA'],         1, 'tier2', 'humectant', ARRAY['hydration'], 'stable', 5, false),
  ('hyaluronic acid',       ARRAY['HA'],                           1, 'tier2', 'humectant', ARRAY['hydration'], 'stable', 5, false),
  ('petrolatum',            ARRAY['Petroleum Jelly','Vaseline'],   1, 'tier2', 'emollient', ARRAY['moisturizing'], 'stable', 3, false),
  ('urea',                  ARRAY['Carbamide'],                    1, 'tier2', 'humectant', ARRAY['hydration','exfoliation'], 'stable', 4, false),
  ('lactic acid',           ARRAY['AHA'],                          3, 'tier2', 'active', ARRAY['exfoliation','brightening','hydration'], 'stable', 5, false)
ON CONFLICT (inci_name) DO NOTHING;

-- Tier 3: Emerging / Trending
INSERT INTO ingredient_safety (inci_name, common_names, ewg_score, tier, function, concerns_addressed, trend, ips_bonus, is_hwahae_blacklisted) VALUES
  ('polydeoxyribonucleotide', ARRAY['PDRN','Salmon DNA'],          1, 'tier3', 'active', ARRAY['anti_aging','hydration'], 'rising', 4, false),
  ('bakuchiol',               ARRAY['Bakuchiol'],                   1, 'tier3', 'active', ARRAY['anti_aging'], 'rising', 4, false),
  ('centella asiatica extract',ARRAY['Cica','Gotu Kola'],           1, 'tier3', 'active', ARRAY['soothing','acne'], 'stable', 4, false),
  ('madecassoside',           ARRAY['Centella derivative'],         1, 'tier3', 'active', ARRAY['soothing'], 'stable', 4, false),
  ('asiaticoside',            ARRAY['Centella derivative'],         1, 'tier3', 'active', ARRAY['soothing','anti_aging'], 'stable', 4, false),
  ('adenosine',               ARRAY['Adenosine'],                   1, 'tier3', 'active', ARRAY['anti_aging'], 'stable', 4, false),
  ('beta-glucan',             ARRAY['Beta Glucan'],                 1, 'tier3', 'humectant', ARRAY['hydration','soothing'], 'rising', 4, false),
  ('polyglutamic acid',       ARRAY['PGA','Gamma-PGA'],             1, 'tier3', 'humectant', ARRAY['hydration'], 'rising', 3, false),
  ('acetyl hexapeptide-8',    ARRAY['Argireline'],                  1, 'tier3', 'active', ARRAY['anti_aging'], 'rising', 3, false),
  ('palmitoyl tripeptide-1',  ARRAY['Matrixyl 3000 part'],          1, 'tier3', 'active', ARRAY['anti_aging'], 'rising', 3, false),
  ('copper tripeptide-1',     ARRAY['GHK-Cu','Copper Peptide'],     1, 'tier3', 'active', ARRAY['anti_aging'], 'rising', 3, false),
  ('artemisia vulgaris extract',ARRAY['Mugwort'],                   1, 'tier3', 'active', ARRAY['soothing'], 'stable', 3, false)
ON CONFLICT (inci_name) DO NOTHING;

-- Tier 4: Supportive
INSERT INTO ingredient_safety (inci_name, common_names, ewg_score, tier, function, concerns_addressed, trend, ips_bonus, is_hwahae_blacklisted) VALUES
  ('glycerin',              ARRAY['Glycerol'],                     1, 'tier4', 'humectant', ARRAY['hydration'], 'stable', 2, false),
  ('squalane',              ARRAY['Hydrogenated Squalene'],        1, 'tier4', 'emollient', ARRAY['moisturizing'], 'stable', 2, false),
  ('panthenol',             ARRAY['Provitamin B5','D-Panthenol'],  1, 'tier4', 'humectant', ARRAY['soothing','hydration'], 'stable', 2, false),
  ('allantoin',             ARRAY['Comfrey Extract'],              1, 'tier4', 'active', ARRAY['soothing'], 'stable', 2, false),
  ('tocopherol',            ARRAY['Vitamin E'],                    1, 'tier4', 'antioxidant', ARRAY['anti_aging'], 'stable', 2, false),
  ('tocopheryl acetate',    ARRAY['Vitamin E Acetate'],            1, 'tier4', 'antioxidant', ARRAY['anti_aging'], 'stable', 2, false),
  ('butyrospermum parkii butter',ARRAY['Shea Butter'],             1, 'tier4', 'emollient', ARRAY['moisturizing'], 'stable', 2, false),
  ('simmondsia chinensis oil',ARRAY['Jojoba Oil'],                 1, 'tier4', 'emollient', ARRAY['moisturizing'], 'stable', 2, false),
  ('aloe barbadensis leaf extract',ARRAY['Aloe Vera'],             1, 'tier4', 'humectant', ARRAY['soothing','hydration'], 'stable', 2, false),
  ('camellia sinensis leaf extract',ARRAY['Green Tea','EGCG'],     1, 'tier4', 'antioxidant', ARRAY['anti_aging','soothing'], 'stable', 2, false),
  ('propolis extract',      ARRAY['Bee Propolis'],                 2, 'tier4', 'antioxidant', ARRAY['soothing','acne'], 'stable', 2, false),
  ('saccharomyces ferment filtrate',ARRAY['Pitera','Galactomyces'],1, 'tier4', 'active', ARRAY['brightening','hydration'], 'stable', 3, false)
ON CONFLICT (inci_name) DO NOTHING;

-- Level 1: Avoid
INSERT INTO ingredient_safety (inci_name, common_names, ewg_score, tier, function, concerns_addressed, trend, ips_penalty, is_hwahae_blacklisted) VALUES
  ('formaldehyde',           ARRAY['Formalin'],                   10, 'avoid', 'preservative', ARRAY[]::text[], 'declining', -15, false),
  ('DMDM hydantoin',        ARRAY['Glydant'],                     8, 'avoid', 'preservative', ARRAY[]::text[], 'declining', -10, true),
  ('imidazolidinyl urea',   ARRAY['Germall 115'],                 7, 'avoid', 'preservative', ARRAY[]::text[], 'declining', -10, true),
  ('diazolidinyl urea',     ARRAY['Germall II'],                  7, 'avoid', 'preservative', ARRAY[]::text[], 'declining', -10, true),
  ('quaternium-15',         ARRAY['Dowicil 200'],                  8, 'avoid', 'preservative', ARRAY[]::text[], 'declining', -10, false),
  ('oxybenzone',            ARRAY['Benzophenone-3'],               8, 'avoid', 'uv_filter', ARRAY[]::text[], 'declining', -12, true),
  ('triclosan',             ARRAY['Irgasan'],                      8, 'avoid', 'preservative', ARRAY[]::text[], 'declining', -12, true),
  ('mercury',               ARRAY['Thimerosal','Mercury Iodide'], 10, 'avoid', 'active', ARRAY[]::text[], 'declining', -15, false)
ON CONFLICT (inci_name) DO NOTHING;

-- Level 2: Caution
INSERT INTO ingredient_safety (inci_name, common_names, ewg_score, tier, function, concerns_addressed, trend, ips_penalty, is_hwahae_blacklisted) VALUES
  ('methylparaben',          ARRAY['Paraben'],                     4, 'caution', 'preservative', ARRAY[]::text[], 'declining', -5, true),
  ('propylparaben',          ARRAY['Paraben'],                     5, 'caution', 'preservative', ARRAY[]::text[], 'declining', -5, true),
  ('butylparaben',           ARRAY['Paraben'],                     7, 'caution', 'preservative', ARRAY[]::text[], 'declining', -5, true),
  ('sodium lauryl sulfate',  ARRAY['SLS'],                         3, 'caution', 'surfactant', ARRAY[]::text[], 'stable', -3, true),
  ('sodium laureth sulfate', ARRAY['SLES'],                        4, 'caution', 'surfactant', ARRAY[]::text[], 'stable', -3, true),
  ('parfum',                 ARRAY['Fragrance','Synthetic Fragrance'], 8, 'caution', 'fragrance', ARRAY[]::text[], 'stable', -5, true),
  ('phenoxyethanol',         ARRAY['PhE'],                         4, 'caution', 'preservative', ARRAY[]::text[], 'stable', -2, true),
  ('BHT',                    ARRAY['Butylated Hydroxytoluene'],    5, 'caution', 'antioxidant', ARRAY[]::text[], 'stable', -3, true),
  ('BHA',                    ARRAY['Butylated Hydroxyanisole'],    6, 'caution', 'antioxidant', ARRAY[]::text[], 'stable', -4, true),
  ('avobenzone',             ARRAY['Butyl Methoxydibenzoylmethane'], 5, 'caution', 'uv_filter', ARRAY[]::text[], 'declining', -3, true),
  ('mineral oil',            ARRAY['Paraffinum Liquidum'],         2, 'caution', 'emollient', ARRAY['moisturizing'], 'stable', -1, true),
  ('homosalate',             ARRAY['Chemical Sunscreen'],          4, 'caution', 'uv_filter', ARRAY[]::text[], 'declining', -3, false),
  ('octinoxate',             ARRAY['Ethylhexyl Methoxycinnamate','OMC'], 6, 'caution', 'uv_filter', ARRAY[]::text[], 'declining', -4, false)
ON CONFLICT (inci_name) DO NOTHING;

-- Level 3: Watch
INSERT INTO ingredient_safety (inci_name, common_names, ewg_score, tier, function, concerns_addressed, trend, ips_penalty, is_hwahae_blacklisted) VALUES
  ('methylisothiazolinone',  ARRAY['MI','Neolone'],                7, 'watch', 'preservative', ARRAY[]::text[], 'declining', -8, false),
  ('isopropyl alcohol',      ARRAY['Rubbing Alcohol'],             3, 'watch', 'solvent', ARRAY[]::text[], 'stable', -1, true),
  ('triethanolamine',        ARRAY['TEA'],                         5, 'watch', 'emulsifier', ARRAY[]::text[], 'stable', -2, true),
  ('propylene glycol',       ARRAY['PG'],                          3, 'watch', 'humectant', ARRAY['hydration'], 'stable', -1, false),
  ('alcohol denat.',         ARRAY['Denatured Alcohol','SD Alcohol'], 3, 'watch', 'solvent', ARRAY[]::text[], 'stable', -1, false),
  ('cocamidopropyl betaine', ARRAY['CAPB'],                        4, 'watch', 'surfactant', ARRAY[]::text[], 'stable', -1, false)
ON CONFLICT (inci_name) DO NOTHING;


-- ── 3. Conflict Families ────────────────────────────────────

INSERT INTO ingredient_conflict_families (id, family_name, conflict_type, description, severity) VALUES
  ('formaldehyde_releasers', 'Formaldehyde Releasers', 'cross_sensitivity', 'Preservatives that release formaldehyde. 40-60% cross-reaction rate.', 'high'),
  ('isothiazolinones',       'Isothiazolinones',       'cross_sensitivity', 'Preservative family. Most common preservative allergy in EU.', 'high'),
  ('fragrance_mix_i',        'Fragrance Mix I',        'cross_sensitivity', 'Standard patch test fragrance allergens.', 'high'),
  ('fragrance_mix_ii',       'Fragrance Mix II',       'cross_sensitivity', 'Extended fragrance allergen panel.', 'moderate'),
  ('asteraceae_botanicals',  'Asteraceae/Compositae',  'cross_sensitivity', 'Plant family cross-reactivity. If allergic to chamomile, risk for all members.', 'moderate'),
  ('para_amino_compounds',   'Para-Amino Compounds',   'cross_sensitivity', 'PPD and related dye/anesthetic cross-reactors.', 'high'),
  ('benzophenone_filters',   'Benzophenone UV Filters','cross_sensitivity', 'Chemical sunscreen family with endocrine disruption concerns.', 'moderate'),
  ('paraben_family',         'Parabens',               'cross_sensitivity', '15-20% cross-reactivity within family. Also cross-reacts with PABA.', 'moderate'),
  ('gallate_antioxidants',   'Gallate Antioxidants',   'cross_sensitivity', 'Propyl/octyl/dodecyl gallate cross-react predictably.', 'low'),

  -- Usage conflicts
  ('retinoid_acid_conflict', 'Retinoids + Acids',      'usage_conflict', 'Both stimulate cell turnover. Compounded barrier disruption.', 'high'),
  ('vitamin_c_acid_conflict','Vitamin C + Acids',       'usage_conflict', 'All acidic; cumulative acid load damages barrier.', 'moderate'),
  ('bpo_retinoid_conflict',  'BPO + Retinoids',        'usage_conflict', 'BPO oxidizes retinol, rendering it ineffective.', 'high'),
  ('peptide_acid_conflict',  'Peptides + Direct Acids', 'usage_conflict', 'Low-pH acids break peptide bonds, deactivating peptides.', 'moderate')
ON CONFLICT (id) DO NOTHING;


-- ── 4. Conflict Family Members ──────────────────────────────

-- Formaldehyde releasers
INSERT INTO ingredient_conflict_members (family_id, inci_name, common_name, notes) VALUES
  ('formaldehyde_releasers', 'formaldehyde',              'Formaldehyde',       'IARC Group 1 carcinogen'),
  ('formaldehyde_releasers', 'DMDM hydantoin',            'Glydant',            'High release rate'),
  ('formaldehyde_releasers', 'imidazolidinyl urea',       'Germall 115',        NULL),
  ('formaldehyde_releasers', 'diazolidinyl urea',         'Germall II',         NULL),
  ('formaldehyde_releasers', 'quaternium-15',             'Dowicil 200',        'Highest release rate of all releasers'),
  ('formaldehyde_releasers', 'bronopol',                  '2-Bromo-2-nitropropane-1,3-diol', NULL),
  ('formaldehyde_releasers', 'sodium hydroxymethylglycinate','Suttocide A',     NULL)
ON CONFLICT DO NOTHING;

-- Isothiazolinones
INSERT INTO ingredient_conflict_members (family_id, inci_name, common_name, notes) VALUES
  ('isothiazolinones', 'methylisothiazolinone',     'MI',   'Banned in EU leave-on products'),
  ('isothiazolinones', 'methylchloroisothiazolinone','MCI',  'Often combined with MI'),
  ('isothiazolinones', 'benzisothiazolinone',       'BIT',  'Less common in cosmetics'),
  ('isothiazolinones', 'octylisothiazolinone',      'OIT',  'Rare in cosmetics')
ON CONFLICT DO NOTHING;

-- Fragrance Mix I
INSERT INTO ingredient_conflict_members (family_id, inci_name, common_name, notes) VALUES
  ('fragrance_mix_i', 'cinnamal',            'Cinnamic Aldehyde',     'Cross-reacts with balsam of Peru'),
  ('fragrance_mix_i', 'isoeugenol',          'Isoeugenol',            'Cross-reacts with eugenol'),
  ('fragrance_mix_i', 'eugenol',             'Eugenol',               'Found in clove oil'),
  ('fragrance_mix_i', 'geraniol',            'Geraniol',              'Cross-reacts with citronellol, linalool'),
  ('fragrance_mix_i', 'hydroxycitronellal',  'Hydroxycitronellal',    NULL),
  ('fragrance_mix_i', 'cinnamyl alcohol',    'Cinnamyl Alcohol',      NULL),
  ('fragrance_mix_i', 'linalool',            'Linalool',              'Oxidized form is the sensitizer'),
  ('fragrance_mix_i', 'limonene',            'Limonene',              'Oxidized form is the sensitizer')
ON CONFLICT DO NOTHING;

-- Asteraceae botanicals
INSERT INTO ingredient_conflict_members (family_id, inci_name, common_name, notes) VALUES
  ('asteraceae_botanicals', 'chamomilla recutita extract', 'Chamomile',    'Cross-reacts with ragweed pollen'),
  ('asteraceae_botanicals', 'arnica montana extract',      'Arnica',       NULL),
  ('asteraceae_botanicals', 'calendula officinalis extract','Calendula',   NULL),
  ('asteraceae_botanicals', 'echinacea purpurea extract',  'Echinacea',   NULL),
  ('asteraceae_botanicals', 'chrysanthemum extract',       'Chrysanthemum',NULL),
  ('asteraceae_botanicals', 'tanacetum parthenium extract','Feverfew',     NULL)
ON CONFLICT DO NOTHING;

-- Para-amino compounds
INSERT INTO ingredient_conflict_members (family_id, inci_name, common_name, notes) VALUES
  ('para_amino_compounds', 'p-phenylenediamine',  'PPD',        'Hair dye allergen'),
  ('para_amino_compounds', 'p-toluenediamine',    'PTD',        'Hair dye'),
  ('para_amino_compounds', 'benzocaine',          'Benzocaine', 'Topical anesthetic'),
  ('para_amino_compounds', 'PABA',                'Para-aminobenzoic acid', 'Deprecated sunscreen')
ON CONFLICT DO NOTHING;

-- Benzophenone family
INSERT INTO ingredient_conflict_members (family_id, inci_name, common_name, notes) VALUES
  ('benzophenone_filters', 'oxybenzone',     'Benzophenone-3', 'Endocrine disruptor, coral toxic'),
  ('benzophenone_filters', 'benzophenone-1', 'BP-1',           NULL),
  ('benzophenone_filters', 'benzophenone-4', 'BP-4',           NULL)
ON CONFLICT DO NOTHING;

-- Paraben family
INSERT INTO ingredient_conflict_members (family_id, inci_name, common_name, notes) VALUES
  ('paraben_family', 'methylparaben',  'Methylparaben',  'Least concerning paraben'),
  ('paraben_family', 'ethylparaben',   'Ethylparaben',   NULL),
  ('paraben_family', 'propylparaben',  'Propylparaben',  NULL),
  ('paraben_family', 'butylparaben',   'Butylparaben',   'Most concerning paraben')
ON CONFLICT DO NOTHING;


-- ── 5. Pairwise Usage Conflicts ─────────────────────────────

INSERT INTO ingredient_pairwise_conflicts (ingredient_a, ingredient_b, conflict_type, severity, resolution) VALUES
  ('retinol',           'glycolic acid',     'irritation',        'avoid',     'Alternate nights'),
  ('retinol',           'lactic acid',       'irritation',        'avoid',     'Alternate nights'),
  ('retinol',           'salicylic acid',    'irritation',        'avoid',     'Alternate nights'),
  ('retinol',           'benzoyl peroxide',  'deactivation',      'avoid',     'Alternate nights or different face zones'),
  ('retinol',           'ascorbic acid',     'irritation',        'caution',   'Vitamin C AM, Retinol PM'),
  ('ascorbic acid',     'glycolic acid',     'ph_incompatible',   'avoid',     'Vitamin C AM, acids PM'),
  ('ascorbic acid',     'salicylic acid',    'ph_incompatible',   'avoid',     'Vitamin C AM, acids PM'),
  ('ascorbic acid',     'benzoyl peroxide',  'deactivation',      'avoid',     'Never combine; different times of day'),
  ('ascorbic acid',     'niacinamide',       'irritation',        'caution',   'Use stable Vitamin C forms or separate routines'),
  ('glycolic acid',     'salicylic acid',    'over_exfoliation',  'caution',   'Choose one per routine; alternate if needed'),
  ('glycolic acid',     'benzoyl peroxide',  'irritation',        'caution',   'Separate routines'),
  ('salicylic acid',    'benzoyl peroxide',  'irritation',        'caution',   'Separate routines'),
  ('acetyl hexapeptide-8','glycolic acid',   'deactivation',      'avoid',     'Acids PM, peptides AM'),
  ('acetyl hexapeptide-8','salicylic acid',  'deactivation',      'avoid',     'Acids PM, peptides AM'),
  ('palmitoyl tripeptide-1','glycolic acid', 'deactivation',      'avoid',     'Acids PM, peptides AM'),
  ('copper tripeptide-1','glycolic acid',    'deactivation',      'avoid',     'Acids PM, peptides AM')
ON CONFLICT DO NOTHING;
