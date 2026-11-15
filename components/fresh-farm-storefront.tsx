'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { onAuthStateChanged, type User } from 'firebase/auth'
import { ArrowDown, ArrowRight, Check, ChevronDown, Clock3, Droplets, Fish, Leaf, MapPin, Menu, Minus, Plus, Scale, Search, ShieldCheck, ShoppingBag, Snowflake, Truck, X } from 'lucide-react'
import { getFirebaseAuth } from '@/lib/firebase-client'
import CheckoutForm from './checkout-form'
import { FlowerCelebration } from './flower-celebration'

type Section = 'chicken' | 'fish'
type Product = {
  id: number
  name: string
  category: string
  categorySlug?: string
  section: Section
  detail: string
  description?: string
  price: number
  unit: string
  image: string
  badge?: string
  availableQuantity: number | null
}

const fallbackProducts: Product[] = [
  { id: 1, name: 'Farm Fresh Whole Chicken', category: 'Whole chicken', section: 'chicken', detail: 'Cleaned to order · 1.2–1.5 kg', price: 245, unit: '/ kg', image: 'https://images.unsplash.com/photo-1604503468506-a8da13d82791?auto=format&fit=crop&w=900&q=85', badge: 'Bestseller', availableQuantity: null },
  { id: 2, name: 'Tender Chicken Breast', category: 'Chicken cuts', section: 'chicken', detail: 'Boneless · skinless · 500 g+', price: 340, unit: '/ kg', image: 'https://images.unsplash.com/photo-1607623814075-e51df1bdc82f?auto=format&fit=crop&w=900&q=85', availableQuantity: null },
  { id: 3, name: 'Country Chicken', category: 'Whole chicken', section: 'chicken', detail: 'Free-range · rich, firm texture', price: 620, unit: '/ kg', image: 'https://images.unsplash.com/photo-1587593810167-a84920ea0781?auto=format&fit=crop&w=900&q=85', badge: 'Farm favourite', availableQuantity: null },
  { id: 4, name: 'Chicken Drumsticks', category: 'Chicken cuts', section: 'chicken', detail: 'Juicy cuts · 4–6 pieces', price: 295, unit: '/ kg', image: 'https://images.unsplash.com/photo-1527477396000-e27163b481c2?auto=format&fit=crop&w=900&q=85', availableQuantity: null },
  { id: 5, name: 'Live Country Hen', category: 'Live hens', section: 'chicken', detail: 'Healthy, locally raised birds', price: 1250, unit: '/ bird', image: 'https://images.unsplash.com/photo-1548550023-2bdb3c5beed7?auto=format&fit=crop&w=900&q=85', badge: 'Limited', availableQuantity: null },
  { id: 6, name: 'Fresh Chicken Wings', category: 'Chicken cuts', section: 'chicken', detail: 'Cleaned and ready to cook', price: 270, unit: '/ kg', image: 'https://images.unsplash.com/photo-1608039829572-78524f79c4c7?auto=format&fit=crop&w=900&q=85', availableQuantity: null },
  { id: 101, name: 'Live Rohu', category: 'Live fish', section: 'fish', detail: 'Live · approx. 1–1.5 kg', price: 220, unit: '/ kg', image: '/fish/live-rohu.svg', badge: 'Live & fresh', availableQuantity: 30 },
  { id: 102, name: 'Live Katla', category: 'Live fish', section: 'fish', detail: 'Live · approx. 1.5–2 kg', price: 260, unit: '/ kg', image: '/fish/live-katla.svg', badge: 'Limited', availableQuantity: 20 },
  { id: 103, name: 'Fresh Pomfret', category: 'Fresh whole fish', section: 'fish', detail: 'Whole · cleaned on request · 400–600 g', price: 780, unit: '/ kg', image: '/fish/fresh-pomfret.svg', badge: 'Today’s catch', availableQuantity: 18 },
  { id: 104, name: 'Fresh Mackerel', category: 'Fresh whole fish', section: 'fish', detail: 'Whole · cleaned on request', price: 340, unit: '/ kg', image: '/fish/fresh-mackerel.svg', availableQuantity: 35 },
  { id: 105, name: 'Tilapia Fillets', category: 'Fish fillets & steaks', section: 'fish', detail: 'Boneless · skinless · 400 g+', price: 420, unit: '/ kg', image: '/fish/tilapia-fillets.svg', badge: 'Chef’s pick', availableQuantity: 25 },
  { id: 106, name: 'Basa Fillets', category: 'Fish fillets & steaks', section: 'fish', detail: 'Boneless · fresh, never frozen', price: 380, unit: '/ kg', image: '/fish/basa-fillets.svg', availableQuantity: 30 },
  { id: 107, name: 'Seer Fish Steaks', category: 'Fish fillets & steaks', section: 'fish', detail: 'Thick-cut · 2–3 steaks', price: 950, unit: '/ kg', image: '/fish/seer-fish-steaks.svg', badge: 'Premium', availableQuantity: 12 },
]

const sectionLabels: Record<Section, string> = { chicken: 'Chicken', fish: 'Fish' }

function unitLabel(unit: string) {
  return unit.replace(/^\s*\/\s*/, '')
}

function formatQuantity(value: number) {
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100)
}

function stockLevel(product: Product) {
  if (product.availableQuantity === null) return null
  const left = Math.max(0, product.availableQuantity)
  const unit = unitLabel(product.unit)
  if (left <= 0) return { state: 'out' as const, short: 'Sold out', label: 'Sold out for today' }
  if (left <= 5) return { state: 'low' as const, short: `${formatQuantity(left)} ${unit} left`, label: `Only ${formatQuantity(left)} ${unit} left today` }
  return { state: 'in' as const, short: 'In stock', label: 'In stock · packed fresh' }
}

function ProductCard({ product, index, quantity, onAdd }: { product: Product; index: number; quantity: number; onAdd: (id: number) => void }) {
  const stock = stockLevel(product)
  const atLimit = product.availableQuantity !== null && quantity >= product.availableQuantity
  const soldOut = stock?.state === 'out'
  const disabled = soldOut || atLimit
  return (
    <article className={product.section === 'fish' ? 'product-card fish-product-card' : 'product-card'}>
      <div className="product-photo">
        <Image src={product.image} alt={product.name} fill sizes="(max-width: 650px) 90vw, (max-width: 1024px) 45vw, 30vw" className="product-image" />
        <span className="product-index">{String(index + 1).padStart(2, '0')}</span>
        {product.badge && <span className="product-badge">{product.badge}</span>}
        {stock && <span className={`stock-badge is-${stock.state}`}>{stock.short}</span>}
        <button
          aria-label={soldOut ? `${product.name} is sold out` : atLimit ? `Maximum available ${product.name} already in your bag` : `Add ${product.name} to bag`}
          className="quick-add"
          disabled={disabled}
          title={atLimit && !soldOut ? `Only ${formatQuantity(product.availableQuantity || 0)} ${unitLabel(product.unit)} available today` : undefined}
          onClick={() => onAdd(product.id)}
        >
          <Plus size={19} />
        </button>
      </div>
      <div className="product-info">
        <div>
          <h3>{product.name}</h3>
          <p>{product.detail}</p>
          {stock && <span className={`stock-line is-${stock.state}`}>{stock.label}</span>}
        </div>
        <div className="product-price"><b>₹{product.price}</b><small>{product.unit}</small></div>
      </div>
    </article>
  )
}

export default function FreshFarmStorefront() {
  const [products, setProducts] = useState<Product[]>(fallbackProducts)
  const [chickenCategory, setChickenCategory] = useState('All chicken')
  const [fishCategory, setFishCategory] = useState('All fish')
  const [signedInUser, setSignedInUser] = useState<User | null>(null)
  const [authToken, setAuthToken] = useState('')
  const [cart, setCart] = useState<Record<number, number>>(() => {
    if (typeof window === 'undefined') return {}
    try {
      const saved = window.localStorage.getItem('fresh-farm-cart')
      return saved ? JSON.parse(saved) as Record<number, number> : {}
    } catch {
      return {}
    }
  })
  const [cartOpen, setCartOpen] = useState(false)
  useEffect(() => {
    const auth = getFirebaseAuth()
    if (!auth) return
    return onAuthStateChanged(auth, nextUser => {
      setSignedInUser(nextUser)
      if (!nextUser) { setAuthToken(''); return }
      nextUser.getIdToken().then(setAuthToken).catch(() => setAuthToken(''))
    })
  }, [])
  useEffect(() => {
    const targets = Array.from(document.querySelectorAll<HTMLElement>('[data-reveal]'))
    if (!targets.length) return
    if (!('IntersectionObserver' in window) || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      targets.forEach(target => target.classList.add('is-visible'))
      return
    }
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible')
          observer.unobserve(entry.target)
        }
      })
    }, { threshold: 0.12, rootMargin: '0px 0px -40px' })
    targets.forEach(target => observer.observe(target))
    return () => observer.disconnect()
  }, [])
  const loadProducts = useCallback(() => {
    let active = true
    fetch('/api/backend/products')
      .then(response => response.ok ? response.json() : null)
      .then(data => {
        if (!active || !data?.products?.length) return
        setProducts(data.products.map((product: Product) => ({
          ...product,
          section: product.section === 'fish' ? 'fish' : 'chicken',
          image: product.image || '/placeholder.jpg',
          unit: product.unit.startsWith('/') ? product.unit : `/${product.unit}`,
          availableQuantity: typeof product.availableQuantity === 'number' ? product.availableQuantity : null,
        })))
        // A stock refresh must never leave more in the bag than the shop has.
        setCart(previous => {
          let changed = false
          const next = { ...previous }
          for (const [id, quantity] of Object.entries(previous)) {
            const product = data.products.find((item: Product) => item.id === Number(id)) as Product | undefined
            if (product && typeof product.availableQuantity === 'number' && quantity > product.availableQuantity) {
              changed = true
              if (product.availableQuantity > 0) next[Number(id)] = product.availableQuantity
              else delete next[Number(id)]
            }
          }
          return changed ? next : previous
        })
      })
      .catch(() => { /* keep the built-in catalogue when the API is offline */ })
    return () => { active = false }
  }, [])
  useEffect(() => loadProducts(), [loadProducts])
  const [newsletterStatus, setNewsletterStatus] = useState('')
  async function subscribe(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const email = (form.elements.namedItem('newsletter-email') as HTMLInputElement).value
    setNewsletterStatus('Joining…')
    try {
      const response = await fetch('/api/backend/newsletter', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(result.error || 'Could not subscribe right now.')
      setNewsletterStatus('You’re on the list. Look out for a note from us soon!')
      form.reset()
    } catch (error) {
      setNewsletterStatus((error as Error).message)
    }
  }
  const [menuOpen, setMenuOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [placedOrder, setPlacedOrder] = useState<{ orderNumber: string; total: number; paymentStatus: string } | null>(null)
  const [checkoutOpen, setCheckoutOpen] = useState(false)

  const chickenProducts = useMemo(() => products.filter(product => product.section === 'chicken'), [products])
  const fishProducts = useMemo(() => products.filter(product => product.section === 'fish'), [products])
  const chickenCategories = useMemo(() => ['All chicken', ...new Set(chickenProducts.map(product => product.category))], [chickenProducts])
  const fishCategories = useMemo(() => ['All fish', ...new Set(fishProducts.map(product => product.category))], [fishProducts])
  const term = search.trim().toLowerCase()
  const matches = (product: Product) => !term || `${product.name} ${product.category} ${product.detail}`.toLowerCase().includes(term)
  const shownChicken = chickenProducts.filter(product => (chickenCategory === 'All chicken' || product.category === chickenCategory) && matches(product))
  const shownFish = fishProducts.filter(product => (fishCategory === 'All fish' || product.category === fishCategory) && matches(product))

  const count = Object.values(cart).reduce((sum, quantity) => sum + quantity, 0)
  const total = Object.entries(cart).reduce((sum, [id, quantity]) => sum + (products.find(p => p.id === Number(id))?.price || 0) * quantity, 0)
  const add = (id: number) => setCart(previous => {
    const product = products.find(item => item.id === id)
    const current = previous[id] || 0
    if (product?.availableQuantity !== null && product?.availableQuantity !== undefined && current >= product.availableQuantity) return previous
    return { ...previous, [id]: current + 1 }
  })
  const remove = (id: number) => setCart(previous => { const next = { ...previous }; if ((next[id] || 0) <= 1) delete next[id]; else next[id]--; return next })

  return (
    <main className="farm-site">
      <FlowerCelebration active={Boolean(placedOrder)} />
      <div className="announcement"><span><Leaf size={14} /> FRESH CHICKEN &amp; TODAY&apos;S CATCH, EVERY SINGLE DAY</span><span className="announcement-right">Free delivery on orders above ₹999 <ArrowRight size={13} /></span></div>
      <header className="site-header">
        <Link className="admin-entry" href="/admin/login" aria-label="Admin sign in"><ShieldCheck size={16} /><span>Admin</span></Link>
        <button className="icon-button mobile-menu" aria-label="Open menu" onClick={() => setMenuOpen(!menuOpen)}><Menu size={21} /></button>
        <a className="brand" href="#home" aria-label="freshfarm good food, grown with care"><span className="brand-mark"><Leaf size={21} /></span><span>fresh<span className="brand-light">farm</span>{' '}<small>GOOD FOOD, GROWN WITH CARE</small></span></a>
        <nav className={menuOpen ? 'main-nav is-open' : 'main-nav'} aria-label="Main navigation"><a href="#shop" onClick={() => setMenuOpen(false)}>Chicken</a><a href="#fish" onClick={() => setMenuOpen(false)}>Fish</a><a href="#story" onClick={() => setMenuOpen(false)}>Our story</a><a href="#promise" onClick={() => setMenuOpen(false)}>Our promise</a><a href="#reviews" onClick={() => setMenuOpen(false)}>Reviews</a></nav>
        <div className="header-actions"><button className="icon-button search-trigger" aria-label="Search products" onClick={() => setSearchOpen(!searchOpen)}><Search size={20} /></button><Link className="account-link" href={signedInUser ? '/dashboard' : '/login'}>{signedInUser ? `My dashboard` : 'Sign in'}</Link><button className="bag-button" onClick={() => { setCartOpen(true); setPlacedOrder(null); setCheckoutOpen(false) }} aria-label={`Bag ${formatQuantity(count)} item${count === 1 ? '' : 's'}`}><ShoppingBag size={18} /><span>Bag</span>{' '}<b>{formatQuantity(count)}</b></button></div>
      </header>
      {searchOpen && <div className="search-bar"><Search size={18} /><input autoFocus value={search} onChange={e => setSearch(e.target.value)} placeholder="Search chicken and fresh fish…" aria-label="Search chicken and fresh fish products" /><button onClick={() => { setSearch(''); setSearchOpen(false) }} aria-label="Close search"><X size={18} /></button></div>}
      <section id="home" className="hero">
        <div className="hero-backdrop"></div>
        <div className="hero-copy">
          <div className="eyebrow"><span className="eyebrow-line"></span> GOOD FOOD STARTS HERE</div>
          <h1>Fresh, honest.<br /><em>Farm to table.</em></h1>
          <p>Thoughtfully raised chicken and today&apos;s fresh catch, prepared each morning and brought straight to your door.</p>
          <div className="hero-actions"><a href="#shop" className="button button-cream">Shop fresh chicken <ArrowRight size={16} /></a><a href="#fish" className="hero-fish-link"><Fish size={16} /> Shop fresh fish</a><a href="#story" className="text-link">Get to know us <ArrowDown size={15} /></a></div>
          <div className="hero-proof"><div className="avatar-stack"><span>F</span><span>A</span><span>M</span><span>+</span></div><div><div className="proof-stars">★★★★★ <b>4.9 / 5</b></div><small>Loved by 2,400+ local families</small></div></div>
        </div>
        <div className="hero-image-wrap"><Image src="/fresh-farm-hero.png" alt="Freshly prepared farm chicken with herbs on a rustic table" fill priority className="hero-image" sizes="(max-width: 760px) 100vw, 56vw" /><div className="hero-image-shade"></div><div className="fresh-seal"><span>RAISED WITH<br />CARE</span><Leaf size={19} /><small>FRESH DAILY</small></div><div className="hero-caption"><span className="caption-dot"></span> TODAY&apos;S HARVEST &amp; CATCH <span>•</span> 6:30 AM</div></div>
        <div className="hero-bottom-label"><span>01 — 03</span><span className="scroll-rule"></span><span>SCROLL TO EXPLORE</span></div>
      </section>
      <section className="trust-strip" aria-label="Our standards"><div><span className="trust-icon"><Leaf size={18} /></span><span><b>Responsibly raised</b><small>Better lives, better food</small></span></div><div><span className="trust-icon"><Clock3 size={18} /></span><span><b>Prepared fresh daily</b><small>Never frozen, always fresh</small></span></div><div><span className="trust-icon"><Truck size={20} /></span><span><b>At your door by noon</b><small>Freshness, delivered</small></span></div><div><span className="trust-icon"><ShieldCheck size={19} /></span><span><b>Quality you can trust</b><small>Every cut, carefully checked</small></span></div></section>

      <section id="shop" className="shop-section" data-reveal>
        <div className="section-heading">
          <div><div className="eyebrow dark-eyebrow"><span className="eyebrow-line"></span> STRAIGHT FROM THE FARM</div><h2>Chicken, <em>raised right.</em></h2></div>
          <a className="view-all" href="#fish">Prefer fish? Visit the fish counter <ArrowRight size={16} /></a>
        </div>
        <div className="shop-toolbar">
          <div className="category-tabs" role="tablist" aria-label="Chicken categories">{chickenCategories.map(item => <button role="tab" aria-selected={chickenCategory === item} key={item} onClick={() => setChickenCategory(item)} className={chickenCategory === item ? 'category-tab active' : 'category-tab'}>{item}</button>)}</div>
          <button className="sort-control" onClick={() => setChickenCategory('All chicken')}>Today&apos;s prices <ChevronDown size={15} /></button>
        </div>
        {shownChicken.length ? (
          <div className="product-grid" role="tabpanel">{shownChicken.map((product, index) => <ProductCard key={product.id} product={product} index={index} quantity={cart[product.id] || 0} onAdd={id => { add(id); setCartOpen(true); setPlacedOrder(null); setCheckoutOpen(false) }} />)}</div>
        ) : (
          <div className="catalogue-empty"><Search size={24} /><h3>No chicken matches that search.</h3><p>Try a different cut or clear the search to see the full range.</p><button className="button button-green" onClick={() => { setSearch(''); setSearchOpen(false); setChickenCategory('All chicken') }}>Show all chicken</button></div>
        )}
        <div className="price-note"><span><span className="price-dot"></span> Prices shown are today&apos;s rates</span><span>Actual weight and final total confirmed after preparation.</span></div>
      </section>

      <section id="fish" className="fish-section" data-reveal>
        <div className="fish-watermark" aria-hidden="true"><Fish size={300} /></div>
        <div className="fish-inner">
          <div className="section-heading fish-heading">
            <div><div className="eyebrow fish-eyebrow"><span className="eyebrow-line"></span> FRESH FROM THE WATER</div><h2>Today&apos;s catch, <em>on ice.</em></h2></div>
            <a className="view-all fish-view-all" href="#fish">Browse the fish counter <ArrowRight size={16} /></a>
          </div>
          <div className="fish-standards" aria-label="Fish counter standards">
            <div><Droplets size={17} /><span><b>Never frozen</b><small>Fresh catch, packed on ice</small></span></div>
            <div><Scale size={17} /><span><b>Weighed after cleaning</b><small>Final weight confirmed with you</small></span></div>
            <div><Snowflake size={17} /><span><b>Cleaned on request</b><small>Our fishmonger prepares it free</small></span></div>
          </div>
          <div className="shop-toolbar fish-toolbar">
            <div className="category-tabs" role="tablist" aria-label="Fish categories">{fishCategories.map(item => <button role="tab" aria-selected={fishCategory === item} key={item} onClick={() => setFishCategory(item)} className={fishCategory === item ? 'category-tab fish-category-tab active' : 'category-tab fish-category-tab'}>{item}</button>)}</div>
            <button className="sort-control fish-sort" onClick={() => setFishCategory('All fish')}>Today&apos;s catch <ChevronDown size={15} /></button>
          </div>
          {shownFish.length ? (
            <div className="product-grid fish-grid" role="tabpanel">{shownFish.map((product, index) => <ProductCard key={product.id} product={product} index={index} quantity={cart[product.id] || 0} onAdd={id => { add(id); setCartOpen(true); setPlacedOrder(null); setCheckoutOpen(false) }} />)}</div>
          ) : (
            <div className="catalogue-empty fish-empty"><Fish size={24} /><h3>No fish matches that search.</h3><p>Try another catch or clear the search to see everything on ice today.</p><button className="button button-cream" onClick={() => { setSearch(''); setSearchOpen(false); setFishCategory('All fish') }}>Show all fish</button></div>
          )}
          <div className="price-note fish-note"><span><span className="price-dot"></span> Live and fresh fish only — no cooked or prepared dishes</span><span>Cleaned, cut and weighed before dispatch.</span></div>
        </div>
      </section>

      <section id="story" className="story-section" data-reveal><div className="story-image"><Image src="https://images.unsplash.com/photo-1500382017468-9049fed747ef?auto=format&fit=crop&w=1400&q=85" alt="Golden morning light over a small green farm" fill sizes="(max-width: 760px) 100vw, 52vw" /><div className="story-image-tag"><Leaf size={16} /> ROOTED IN GOODNESS</div></div><div className="story-copy"><div className="eyebrow"><span className="eyebrow-line"></span> A LITTLE MORE CARE, IN EVERY BITE</div><h2>Know where your<br />good food <em>comes from.</em></h2><p>We work with a small circle of local farms and fishing families who share our belief: when food is raised and caught with care, you can taste the difference. Each morning, our butchers and fishmonger prepare just what we need for the day.</p><a className="button button-cream" href="#promise">Our way of doing things <ArrowRight size={16} /></a><div className="story-stat"><b>100%</b><span>Traceable to farms and<br />boats we know by name</span><span className="stat-divider"></span><b>0</b><span>Shortcuts in the<br />things we sell</span></div></div></section>
      <section id="promise" className="promise-section" data-reveal><div className="eyebrow"><span className="eyebrow-line"></span> OUR PROMISE TO YOUR TABLE</div><h2>Not just fresh. <em>Farm fresh.</em></h2><p>Good food isn&apos;t complicated. It just takes a little more care.</p><div className="promise-cards"><article><span>01</span><Leaf size={24} /><h3>Raised right</h3><p>Healthy birds and responsibly caught fish from nearby farms and boats that put welfare first.</p></article><article><span>02</span><Clock3 size={24} /><h3>Fresh every day</h3><p>Prepared in small batches each morning. What sells out, sells out.</p></article><article><span>03</span><ShieldCheck size={24} /><h3>Nothing to hide</h3><p>Honest prices, clear sourcing, and quality checked by our team.</p></article></div></section>
      <section id="reviews" className="review-section"><div className="review-mark">“</div><p className="review-quote">You can taste the difference. My kids ask for Fresh Farm chicken by name now — and the fish is just as fresh as the market.</p><div className="review-by"><span className="review-stars">★★★★★</span><span>PRIYA S. <i>•</i> CUSTOMER SINCE 2022</span></div><div className="review-count">4.9 <span>★★★★★</span> FROM 2,400+ HAPPY TABLES</div></section>
      <section className="newsletter"><div><div className="eyebrow"><span className="eyebrow-line"></span> A GOOD THING IN YOUR INBOX</div><h2>Fresh news. <em>No fuss.</em></h2><p>Seasonal picks, farm stories, and a little something for your next order.</p></div><form onSubmit={subscribe}><label className="sr-only" htmlFor="newsletter-email">Email address</label><input id="newsletter-email" name="newsletter-email" required type="email" placeholder="Your email address" /><button type="submit">Count me in <ArrowRight size={16} /></button>{newsletterStatus && <small role="status">{newsletterStatus}</small>}<small>By subscribing, you agree to receive the occasional note from us.</small></form></section>
      <footer className="site-footer"><div className="footer-main"><a className="brand footer-brand" href="#home"><span className="brand-mark"><Leaf size={21} /></span><span>fresh<span className="brand-light">farm</span><small>GOOD FOOD, GROWN WITH CARE</small></span></a><p>Fresh chicken, fresh fish.<br />Fair prices. Delivered daily.</p><div className="footer-location"><MapPin size={17} /><span>Serving our neighbourhood<br /><small>Monday – Saturday · 7 am – 7 pm</small></span></div><div className="footer-links"><a href="#shop">Fresh chicken</a><a href="#fish">Fresh fish</a><a href="#story">Our story</a><Link href="/dashboard">My dashboard</Link><Link href="/account">Track guest order</Link><Link href="/admin/login">Farmhouse</Link></div></div><div className="footer-bottom"><span>© 2025 Fresh Farm. Made with care.</span><span>Fresh Chicken. Fresh Fish. Fair Prices.</span><a href="#home">Back to top ↑</a></div></footer>

      {cartOpen && <div className="drawer-backdrop" onClick={() => setCartOpen(false)}><aside className="cart-drawer" onClick={e => e.stopPropagation()} aria-label="Shopping bag"><div className="drawer-heading"><div><span className="eyebrow dark-eyebrow">YOUR FARM BAG</span><h2>{placedOrder ? 'Order received.' : checkoutOpen ? 'Almost there.' : 'The good stuff.'}</h2></div><button aria-label="Close bag" className="icon-button" onClick={() => { setCartOpen(false); setCheckoutOpen(false) }}><X size={20} /></button></div>{placedOrder ? <div className="order-success"><span className="success-icon"><Check size={24} /></span><h3>Thanks for choosing fresh.</h3><p>Order <b>{placedOrder.orderNumber}</b> is saved{placedOrder.paymentStatus === 'paid' ? ' and your payment is confirmed' : ''}. We&apos;ll confirm availability and final weight with you shortly.</p><button className="button button-green" onClick={() => { setCart({}); setCartOpen(false); setPlacedOrder(null); setCheckoutOpen(false) }}>Back to shopping <ArrowRight size={16} /></button></div> : checkoutOpen ? <CheckoutForm items={Object.entries(cart).filter(([id]) => products.some(item => item.id === Number(id))).map(([id, quantity]) => { const p = products.find(item => item.id === Number(id))!; return { productId: p.id, name: p.name, price: p.price, quantity, unit: p.unit, lineTotal: p.price * quantity } })} subtotal={total} token={authToken || undefined} initialCustomer={{ fullName: signedInUser?.displayName || '', email: signedInUser?.email || '', phone: '' }} onBack={() => setCheckoutOpen(false)} onPlaced={order => { setPlacedOrder(order); setCart({}); setCheckoutOpen(false); void loadProducts() }} /> : count === 0 ? <div className="empty-cart"><ShoppingBag size={34} /><h3>Your bag is waiting.</h3><p>Good things are grown fresh and caught fresh every morning.</p><button className="button button-green" onClick={() => setCartOpen(false)}>Explore the shop <ArrowRight size={16} /></button></div> : <><div className="cart-items">{Object.entries(cart).filter(([id]) => products.some(item => item.id === Number(id))).map(([id, quantity]) => { const p = products.find(item => item.id === Number(id))!; const atLimit = p.availableQuantity !== null && quantity >= p.availableQuantity; return <div className="cart-item" key={id}><div className="cart-thumb"><Image src={p.image} alt="" fill sizes="84px" /></div><div className="cart-item-info"><span className={`cart-section-chip is-${p.section}`}>{sectionLabels[p.section]}</span><h3>{p.name}</h3><p>₹{p.price} {p.unit}</p><div className="quantity-control"><button onClick={() => remove(p.id)} aria-label={`Remove one ${p.name}`}><Minus size={13} /></button><span>{formatQuantity(quantity)}</span><button onClick={() => add(p.id)} disabled={atLimit} aria-label={`Add one ${p.name}`} title={atLimit ? 'No more stock available today' : undefined}><Plus size={13} /></button></div></div><b>₹{p.price * quantity}</b></div> })}</div><div className="cart-summary"><div><span>Estimated subtotal</span><b>₹{total.toLocaleString('en-IN')}</b></div><p><Check size={14} /> Final total is confirmed after your order is weighed.</p><button className="button button-green checkout-button" onClick={async () => { setCheckoutOpen(true); setPlacedOrder(null); if (signedInUser) { try { setAuthToken(await signedInUser.getIdToken()) } catch { /* guest checkout still works */ } } }}>Continue to checkout <ArrowRight size={16} /></button><small>Secure online payment or cash on delivery · Home delivery or shop pickup</small></div></>}</aside></div>}
    </main>
  )
}
