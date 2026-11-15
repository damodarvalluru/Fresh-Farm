CREATE DATABASE IF NOT EXISTS fresh_farm CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
USE fresh_farm;

CREATE TABLE IF NOT EXISTS roles (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  name ENUM('CUSTOMER','ADMIN','MANAGER','ORDER_MANAGER') NOT NULL UNIQUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  firebase_uid VARCHAR(128) NOT NULL UNIQUE,
  email VARCHAR(254) NOT NULL UNIQUE,
  full_name VARCHAR(160) NOT NULL,
  phone VARCHAR(32),
  role_id BIGINT UNSIGNED NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_users_role FOREIGN KEY (role_id) REFERENCES roles(id),
  INDEX idx_users_phone (phone)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS admins (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL UNIQUE,
  role_id BIGINT UNSIGNED NOT NULL,
  display_name VARCHAR(160),
  password_hash VARCHAR(255),
  pin_hash VARCHAR(255),
  profile_image_url MEDIUMTEXT,
  password_updated_at DATETIME,
  last_login_at DATETIME,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_admin_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_admin_role FOREIGN KEY (role_id) REFERENCES roles(id),
  INDEX idx_admin_role_active (role_id, is_active)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS admin_sessions (
  id CHAR(36) PRIMARY KEY,
  admin_id BIGINT UNSIGNED NOT NULL,
  token_hash CHAR(64) NOT NULL UNIQUE,
  expires_at DATETIME NOT NULL,
  revoked_at DATETIME,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_sessions_admin FOREIGN KEY (admin_id) REFERENCES admins(id) ON DELETE CASCADE,
  INDEX idx_sessions_expiry (expires_at), INDEX idx_sessions_admin (admin_id, revoked_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS permissions (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(80) NOT NULL UNIQUE,
  description VARCHAR(255)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS role_permissions (
  role_id BIGINT UNSIGNED NOT NULL,
  permission_id BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (role_id, permission_id),
  CONSTRAINT fk_rp_role FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
  CONSTRAINT fk_rp_permission FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS categories (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(120) NOT NULL UNIQUE,
  slug VARCHAR(140) NOT NULL UNIQUE,
  section ENUM('chicken','fish') NOT NULL DEFAULT 'chicken',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_categories_section (section, is_active, sort_order)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS products (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  category_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(180) NOT NULL,
  slug VARCHAR(200) NOT NULL UNIQUE,
  detail VARCHAR(255),
  description TEXT,
  badge VARCHAR(60),
  selling_unit ENUM('kg','bird','item') NOT NULL,
  price DECIMAL(10,2) NOT NULL,
  cost_price DECIMAL(10,2) NOT NULL DEFAULT 0,
  is_available BOOLEAN NOT NULL DEFAULT TRUE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_products_category FOREIGN KEY (category_id) REFERENCES categories(id),
  CONSTRAINT chk_product_price CHECK (price >= 0),
  INDEX idx_products_category_active (category_id, is_active, is_available)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS product_images (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  product_id BIGINT UNSIGNED NOT NULL,
  image_url VARCHAR(2048) NOT NULL,
  alt_text VARCHAR(255),
  sort_order INT NOT NULL DEFAULT 0,
  CONSTRAINT fk_images_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS product_variants (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  product_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(120) NOT NULL,
  price_delta DECIMAL(10,2) NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  CONSTRAINT fk_variants_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  CONSTRAINT chk_variant_price CHECK (price_delta >= 0)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS price_history (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  product_id BIGINT UNSIGNED NOT NULL,
  old_price DECIMAL(10,2) NOT NULL,
  new_price DECIMAL(10,2) NOT NULL,
  changed_by BIGINT UNSIGNED,
  effective_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_price_product FOREIGN KEY (product_id) REFERENCES products(id),
  CONSTRAINT fk_price_admin FOREIGN KEY (changed_by) REFERENCES admins(id) ON DELETE SET NULL,
  INDEX idx_price_history (product_id, effective_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS inventory (
  product_id BIGINT UNSIGNED PRIMARY KEY,
  available_quantity DECIMAL(10,3) NOT NULL DEFAULT 0,
  unit ENUM('kg','bird','item') NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_inventory_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  CONSTRAINT chk_inventory_qty CHECK (available_quantity >= 0)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS addresses (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  recipient_name VARCHAR(160) NOT NULL,
  phone VARCHAR(32) NOT NULL,
  line1 VARCHAR(255) NOT NULL,
  line2 VARCHAR(255),
  landmark VARCHAR(160),
  city VARCHAR(120) NOT NULL,
  postal_code VARCHAR(20) NOT NULL,
  delivery_instructions VARCHAR(500),
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_address_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_addresses_user (user_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS coupons (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  code VARCHAR(40) NOT NULL UNIQUE,
  discount_type ENUM('fixed','percent') NOT NULL,
  discount_value DECIMAL(10,2) NOT NULL,
  minimum_order DECIMAL(10,2) NOT NULL DEFAULT 0,
  starts_at DATETIME,
  ends_at DATETIME,
  usage_limit INT UNSIGNED,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  CONSTRAINT chk_coupon_discount CHECK (discount_value > 0)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS delivery_agents (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(160) NOT NULL,
  phone VARCHAR(32) NOT NULL,
  email VARCHAR(254),
  vehicle_type ENUM('bike','scooter','car','van','other') NOT NULL DEFAULT 'bike',
  vehicle_number VARCHAR(40),
  service_area VARCHAR(160),
  max_active_orders INT UNSIGNED NOT NULL DEFAULT 5,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  notes VARCHAR(500),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_delivery_agent_phone (phone),
  INDEX idx_delivery_agent_active (is_active, name)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS orders (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  order_number VARCHAR(32) NOT NULL UNIQUE,
  client_order_id VARCHAR(80),
  customer_id BIGINT UNSIGNED NOT NULL,
  address_id BIGINT UNSIGNED,
  delivery_agent_id BIGINT UNSIGNED,
  fulfilment ENUM('delivery','pickup') NOT NULL,
  status ENUM('pending','accepted','preparing','ready','out_for_delivery','delivered','rejected','cancelled') NOT NULL DEFAULT 'pending',
  payment_method ENUM('cash_on_delivery','upi','online') NOT NULL DEFAULT 'cash_on_delivery',
  payment_status ENUM('pending','authorized','paid','failed','refunded') NOT NULL DEFAULT 'pending',
  subtotal_estimated DECIMAL(10,2) NOT NULL,
  delivery_fee DECIMAL(10,2) NOT NULL DEFAULT 0,
  discount_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
  total_estimated DECIMAL(10,2) NOT NULL,
  total_final DECIMAL(10,2),
  customer_notes VARCHAR(1000),
  assigned_at DATETIME,
  delivered_at DATETIME,
  cancelled_at DATETIME,
  cancellation_reason VARCHAR(500),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_order_customer FOREIGN KEY (customer_id) REFERENCES users(id),
  CONSTRAINT fk_order_address FOREIGN KEY (address_id) REFERENCES addresses(id) ON DELETE SET NULL,
  CONSTRAINT fk_order_agent FOREIGN KEY (delivery_agent_id) REFERENCES delivery_agents(id) ON DELETE SET NULL,
  UNIQUE KEY uq_orders_client (customer_id, client_order_id),
  INDEX idx_orders_customer_date (customer_id, created_at),
  INDEX idx_orders_status_date (status, created_at),
  INDEX idx_orders_agent (delivery_agent_id, status),
  INDEX idx_orders_payment_date (payment_status, created_at),
  CONSTRAINT chk_order_totals CHECK (subtotal_estimated >= 0 AND total_estimated >= 0)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS order_items (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  order_id BIGINT UNSIGNED NOT NULL,
  product_id BIGINT UNSIGNED NOT NULL,
  product_name_snapshot VARCHAR(180) NOT NULL,
  unit_snapshot ENUM('kg','bird','item') NOT NULL,
  price_snapshot DECIMAL(10,2) NOT NULL,
  cost_snapshot DECIMAL(10,2) NOT NULL DEFAULT 0,
  requested_quantity DECIMAL(10,3) NOT NULL,
  actual_quantity DECIMAL(10,3),
  estimated_line_total DECIMAL(10,2) NOT NULL,
  final_line_total DECIMAL(10,2),
  preparation_options JSON,
  CONSTRAINT fk_item_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  CONSTRAINT fk_item_product FOREIGN KEY (product_id) REFERENCES products(id),
  CONSTRAINT chk_requested_quantity CHECK (requested_quantity > 0),
  INDEX idx_order_items (order_id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS payments (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  order_id BIGINT UNSIGNED NOT NULL,
  provider VARCHAR(40) NOT NULL,
  provider_order_id VARCHAR(180) UNIQUE,
  provider_payment_id VARCHAR(180) UNIQUE,
  provider_reference VARCHAR(180),
  amount DECIMAL(10,2) NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'INR',
  status ENUM('pending','authorized','captured','failed','refunded') NOT NULL DEFAULT 'pending',
  idempotency_key VARCHAR(100) UNIQUE,
  failure_reason VARCHAR(500),
  confirmed_at DATETIME,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_payment_order FOREIGN KEY (order_id) REFERENCES orders(id),
  INDEX idx_payment_order (order_id),
  INDEX idx_payments_status_date (status, created_at)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS order_status_events (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  order_id BIGINT UNSIGNED NOT NULL,
  status VARCHAR(40) NOT NULL,
  note VARCHAR(500),
  created_by BIGINT UNSIGNED,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_status_event_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  CONSTRAINT fk_status_event_admin FOREIGN KEY (created_by) REFERENCES admins(id) ON DELETE SET NULL,
  INDEX idx_status_events_order (order_id, created_at)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS order_assignments (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  order_id BIGINT UNSIGNED NOT NULL,
  agent_id BIGINT UNSIGNED NOT NULL,
  assigned_by BIGINT UNSIGNED,
  status ENUM('active','completed','cancelled') NOT NULL DEFAULT 'active',
  note VARCHAR(500),
  assigned_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ended_at DATETIME(6) NOT NULL DEFAULT '1970-01-01 00:00:00.000000',
  UNIQUE KEY uq_assignment_active_order (order_id, ended_at),
  CONSTRAINT fk_assignment_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  CONSTRAINT fk_assignment_agent FOREIGN KEY (agent_id) REFERENCES delivery_agents(id) ON DELETE CASCADE,
  CONSTRAINT fk_assignment_admin FOREIGN KEY (assigned_by) REFERENCES admins(id) ON DELETE SET NULL,
  INDEX idx_assignment_agent (agent_id, status, assigned_at),
  INDEX idx_assignment_order (order_id, assigned_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS operating_expenses (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  category ENUM('delivery','packaging','salaries','utilities','marketing','rent','other') NOT NULL DEFAULT 'other',
  title VARCHAR(160) NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  expense_date DATE NOT NULL,
  notes VARCHAR(500),
  created_by BIGINT UNSIGNED,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_expense_admin FOREIGN KEY (created_by) REFERENCES admins(id) ON DELETE SET NULL,
  CONSTRAINT chk_expense_amount CHECK (amount >= 0),
  INDEX idx_expense_date (expense_date),
  INDEX idx_expense_category (category, expense_date)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS reviews (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  customer_id BIGINT UNSIGNED NOT NULL,
  order_id BIGINT UNSIGNED NOT NULL,
  rating TINYINT UNSIGNED NOT NULL,
  body VARCHAR(1000),
  is_published BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_review_customer FOREIGN KEY (customer_id) REFERENCES users(id),
  CONSTRAINT fk_review_order FOREIGN KEY (order_id) REFERENCES orders(id),
  CONSTRAINT chk_review_rating CHECK (rating BETWEEN 1 AND 5),
  INDEX idx_reviews_published (is_published, created_at)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS newsletter_subscribers (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  email VARCHAR(254) NOT NULL UNIQUE,
  source VARCHAR(60) NOT NULL DEFAULT 'website',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS contact_messages (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(160) NOT NULL,
  email VARCHAR(254) NOT NULL,
  phone VARCHAR(32),
  message VARCHAR(2000) NOT NULL,
  is_handled BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_contact_handled (is_handled, created_at)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS shop_settings (
  setting_key VARCHAR(100) PRIMARY KEY,
  setting_value JSON NOT NULL,
  updated_by BIGINT UNSIGNED,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_settings_admin FOREIGN KEY (updated_by) REFERENCES admins(id) ON DELETE SET NULL
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  actor_user_id BIGINT UNSIGNED,
  action VARCHAR(120) NOT NULL,
  entity_type VARCHAR(80) NOT NULL,
  entity_id VARCHAR(100),
  details JSON,
  ip_address VARBINARY(16),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_audit_actor FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_audit_action_date (action, created_at),
  INDEX idx_audit_entity (entity_type, entity_id)
) ENGINE=InnoDB;

INSERT INTO roles (name) VALUES ('CUSTOMER'),('ADMIN'),('MANAGER'),('ORDER_MANAGER')
ON DUPLICATE KEY UPDATE name=VALUES(name);
INSERT INTO permissions (name, description) VALUES
('products:write','Create and update products'),('inventory:write','Manage stock'),
('orders:read','View orders'),('orders:write','Update order status and actual weights'),
('reports:read','View business reports'),('staff:write','Manage staff and roles'),
('settings:write','Manage shop settings') ON DUPLICATE KEY UPDATE description=VALUES(description);
INSERT INTO role_permissions (role_id,permission_id)
SELECT r.id,p.id FROM roles r CROSS JOIN permissions p WHERE
(r.name='ADMIN') OR (r.name='MANAGER' AND p.name IN ('products:write','inventory:write','orders:read','orders:write','reports:read')) OR
(r.name='ORDER_MANAGER' AND p.name IN ('orders:read','orders:write'))
ON DUPLICATE KEY UPDATE permission_id=VALUES(permission_id);

INSERT INTO shop_settings (setting_key, setting_value) VALUES
('store', JSON_OBJECT('currency','INR','freeDeliveryAbove',999,'deliveryFee',49,'supportPhone','+919573102505'))
ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value);
