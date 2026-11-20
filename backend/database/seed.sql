USE fresh_farm;

-- Safe, non-secret starter catalog. Prices and availability remain owner-managed.
INSERT INTO categories (name, slug, section, sort_order) VALUES
('Whole chicken','whole-chicken','chicken',10),
('Chicken cuts','chicken-cuts','chicken',20),
('Live hens','live-hens','chicken',30),
('Other products','other-products','chicken',40),
('Live fish','live-fish','fish',110),
('Fresh whole fish','fresh-whole-fish','fish',120),
('Fish fillets & steaks','fish-fillets-steaks','fish',130)
ON DUPLICATE KEY UPDATE name=VALUES(name), section=VALUES(section), sort_order=VALUES(sort_order);

INSERT INTO products (category_id, name, slug, detail, description, badge, selling_unit, price) VALUES
((SELECT id FROM categories WHERE slug='whole-chicken'), 'Farm Fresh Whole Chicken', 'farm-fresh-whole-chicken', 'Cleaned to order · 1.2–1.5 kg', 'Whole chicken cleaned and prepared fresh each morning. Final weight is confirmed after preparation.', 'Bestseller', 'kg', 245),
((SELECT id FROM categories WHERE slug='chicken-cuts'), 'Tender Chicken Breast', 'tender-chicken-breast', 'Boneless · skinless · 500 g+', 'Boneless, skinless breast fillets trimmed by our butchers.', NULL, 'kg', 340),
((SELECT id FROM categories WHERE slug='whole-chicken'), 'Country Chicken', 'country-chicken', 'Free-range · rich, firm texture', 'Free-range country chicken with a firmer texture and deeper flavour.', 'Farm favourite', 'kg', 620),
((SELECT id FROM categories WHERE slug='chicken-cuts'), 'Chicken Drumsticks', 'chicken-drumsticks', 'Juicy cuts · 4–6 pieces', 'Juicy drumsticks, cleaned and ready to cook.', NULL, 'kg', 295),
((SELECT id FROM categories WHERE slug='live-hens'), 'Live Country Hen', 'live-country-hen', 'Healthy, locally raised birds', 'Healthy locally raised live hen. Availability is limited and confirmed by our team.', 'Limited', 'bird', 1250),
((SELECT id FROM categories WHERE slug='chicken-cuts'), 'Fresh Chicken Wings', 'fresh-chicken-wings', 'Cleaned and ready to cook', 'Fresh wings cleaned and packed the same morning.', NULL, 'kg', 270),
((SELECT id FROM categories WHERE slug='live-fish'), 'Live Rohu', 'live-rohu', 'Live · approx. 1–1.5 kg', 'Live rohu from today’s catch. Our fishmonger cleans and cuts it free of charge while you wait.', 'Live & fresh', 'kg', 220),
((SELECT id FROM categories WHERE slug='live-fish'), 'Live Katla', 'live-katla', 'Live · approx. 1.5–2 kg', 'Live katla, firm and sweet. Cleaned on request; availability is limited each morning.', 'Limited', 'kg', 260),
((SELECT id FROM categories WHERE slug='fresh-whole-fish'), 'Fresh Pomfret', 'fresh-pomfret', 'Whole · cleaned on request · 400–600 g', 'Whole white pomfret, cleaned and packed fresh. Never frozen and never pre-cut.', 'Today’s catch', 'kg', 780),
((SELECT id FROM categories WHERE slug='fresh-whole-fish'), 'Fresh Mackerel', 'fresh-mackerel', 'Whole · cleaned on request', 'Line-caught mackerel with a rich flavour, cleaned to order the same morning.', NULL, 'kg', 340),
((SELECT id FROM categories WHERE slug='fish-fillets-steaks'), 'Tilapia Fillets', 'tilapia-fillets', 'Boneless · skinless · 400 g+', 'Boneless, skinless tilapia fillets trimmed by hand. Fresh, never frozen.', 'Chef’s pick', 'kg', 420),
((SELECT id FROM categories WHERE slug='fish-fillets-steaks'), 'Basa Fillets', 'basa-fillets', 'Boneless · fresh, never frozen', 'Mild, soft basa fillets cut fresh each morning and packed on ice.', NULL, 'kg', 380),
((SELECT id FROM categories WHERE slug='fish-fillets-steaks'), 'Seer Fish Steaks', 'seer-fish-steaks', 'Thick-cut · 2–3 steaks', 'Premium seer fish cut into thick steaks with the bone in, ready for the pan.', 'Premium', 'kg', 950)
ON DUPLICATE KEY UPDATE name=VALUES(name), detail=VALUES(detail), description=VALUES(description), badge=VALUES(badge), selling_unit=VALUES(selling_unit), price=VALUES(price), category_id=VALUES(category_id);

INSERT INTO product_images (product_id, image_url, alt_text, sort_order) VALUES
((SELECT id FROM products WHERE slug='farm-fresh-whole-chicken'), 'https://images.unsplash.com/photo-1604503468506-a8da13d82791?auto=format&fit=crop&w=900&q=85', 'Farm fresh whole chicken', 1),
((SELECT id FROM products WHERE slug='tender-chicken-breast'), 'https://images.unsplash.com/photo-1607623814075-e51df1bdc82f?auto=format&fit=crop&w=900&q=85', 'Tender chicken breast', 1),
((SELECT id FROM products WHERE slug='country-chicken'), 'https://images.unsplash.com/photo-1587593810167-a84920ea0781?auto=format&fit=crop&w=900&q=85', 'Country chicken', 1),
((SELECT id FROM products WHERE slug='chicken-drumsticks'), 'https://images.unsplash.com/photo-1527477396000-e27163b481c2?auto=format&fit=crop&w=900&q=85', 'Chicken drumsticks', 1),
((SELECT id FROM products WHERE slug='live-country-hen'), 'https://images.unsplash.com/photo-1548550023-2bdb3c5beed7?auto=format&fit=crop&w=900&q=85', 'Live country hen', 1),
((SELECT id FROM products WHERE slug='fresh-chicken-wings'), 'https://images.unsplash.com/photo-1608039829572-78524f79c4c7?auto=format&fit=crop&w=900&q=85', 'Fresh chicken wings', 1),
((SELECT id FROM products WHERE slug='live-rohu'), '/fish/live-rohu.jpg', 'Live rohu (Labeo rohita)', 1),
((SELECT id FROM products WHERE slug='live-katla'), '/fish/live-katla.jpg', 'Live katla, a freshwater carp', 1),
((SELECT id FROM products WHERE slug='fresh-pomfret'), '/fish/fresh-pomfret.jpg', 'Fresh whole silver pomfret', 1),
((SELECT id FROM products WHERE slug='fresh-mackerel'), '/fish/fresh-mackerel.jpg', 'Fresh Atlantic mackerel', 1),
((SELECT id FROM products WHERE slug='tilapia-fillets'), '/fish/tilapia-fillets.jpg', 'Raw tilapia fillets, never frozen', 1),
((SELECT id FROM products WHERE slug='basa-fillets'), '/fish/basa-fillets.jpg', 'Fresh boneless basa fillets', 1),
((SELECT id FROM products WHERE slug='seer-fish-steaks'), '/fish/seer-fish-steaks.jpg', 'Fresh seer fish (Scomberomorus commerson)', 1)
ON DUPLICATE KEY UPDATE image_url=VALUES(image_url), alt_text=VALUES(alt_text);

-- Existing shops may already have SVG placeholders. Re-running the seed
-- updates those rows to real photographs without creating extra images.
UPDATE product_images pi JOIN products p ON p.id = pi.product_id SET pi.image_url = '/fish/live-rohu.jpg', pi.alt_text = 'Live rohu (Labeo rohita)' WHERE p.slug = 'live-rohu';
UPDATE product_images pi JOIN products p ON p.id = pi.product_id SET pi.image_url = '/fish/live-katla.jpg', pi.alt_text = 'Live katla, a freshwater carp' WHERE p.slug = 'live-katla';
UPDATE product_images pi JOIN products p ON p.id = pi.product_id SET pi.image_url = '/fish/fresh-pomfret.jpg', pi.alt_text = 'Fresh whole silver pomfret' WHERE p.slug = 'fresh-pomfret';
UPDATE product_images pi JOIN products p ON p.id = pi.product_id SET pi.image_url = '/fish/fresh-mackerel.jpg', pi.alt_text = 'Fresh Atlantic mackerel' WHERE p.slug = 'fresh-mackerel';
UPDATE product_images pi JOIN products p ON p.id = pi.product_id SET pi.image_url = '/fish/tilapia-fillets.jpg', pi.alt_text = 'Raw tilapia fillets, never frozen' WHERE p.slug = 'tilapia-fillets';
UPDATE product_images pi JOIN products p ON p.id = pi.product_id SET pi.image_url = '/fish/basa-fillets.jpg', pi.alt_text = 'Fresh boneless basa fillets' WHERE p.slug = 'basa-fillets';
UPDATE product_images pi JOIN products p ON p.id = pi.product_id SET pi.image_url = '/fish/seer-fish-steaks.jpg', pi.alt_text = 'Fresh seer fish (Scomberomorus commerson)' WHERE p.slug = 'seer-fish-steaks';

-- Stock rows are only created when missing; re-running the seed never resets
-- quantities that the shop has already been selling down.
INSERT INTO inventory (product_id, available_quantity, unit)
SELECT p.id, 50, p.selling_unit FROM products p JOIN categories c ON c.id = p.category_id WHERE c.section = 'chicken'
ON DUPLICATE KEY UPDATE unit=VALUES(unit);

INSERT INTO inventory (product_id, available_quantity, unit) VALUES
((SELECT id FROM products WHERE slug='live-rohu'), 30, 'kg'),
((SELECT id FROM products WHERE slug='live-katla'), 20, 'kg'),
((SELECT id FROM products WHERE slug='fresh-pomfret'), 18, 'kg'),
((SELECT id FROM products WHERE slug='fresh-mackerel'), 35, 'kg'),
((SELECT id FROM products WHERE slug='tilapia-fillets'), 25, 'kg'),
((SELECT id FROM products WHERE slug='basa-fillets'), 30, 'kg'),
((SELECT id FROM products WHERE slug='seer-fish-steaks'), 12, 'kg')
ON DUPLICATE KEY UPDATE unit=VALUES(unit);

-- No users, admin credentials, or production data are seeded.
