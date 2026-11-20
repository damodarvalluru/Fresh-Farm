'use client'

import { useEffect, useLayoutEffect, useState } from 'react'

/* Runs before paint on the client without producing an SSR useLayoutEffect warning. */
const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

type Particle = {
  x: number
  y: number
  r: number
  vx: number
  vy: number
  ph: number
}

export default function MotionLayer() {
  const [loader, setLoader] = useState<'none' | 'show' | 'done'>('none')

  useIsoLayoutEffect(() => {
    const site = document.querySelector<HTMLElement>('.farm-site')
    if (!site) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    const root = document.documentElement
    root.classList.add('fx-on')

    const ac = new AbortController()
    const sig = ac.signal
    const qsa = <T extends Element = HTMLElement>(sel: string) =>
      Array.from(document.querySelectorAll<T>(sel))

    const tag = (sel: string, fx: string, stagger = false) => {
      qsa<HTMLElement>(sel).forEach((el, i) => {
        el.dataset.fx = fx
        if (stagger) el.style.setProperty('--i', String(i % 8))
      })
    }

    /* ---------- tag existing elements; no JSX changes required ---------- */
    const headings = qsa<HTMLElement>(
      '#home h1, #shop h2, #fish h2, #story h2, #promise h2, .newsletter h2',
    )
    headings.forEach(el => { el.dataset.fx = 'words' })
    const heroHeading = qsa<HTMLElement>('#home h1')[0]
    if (heroHeading) heroHeading.dataset.fxSlice = ''

    tag(
      '.hero-copy .eyebrow, .hero-copy > p, .hero-actions, .hero-proof,' +
      ' .trust-strip > div, .shop-chooser-copy > *, .section-heading > div,' +
      ' .view-all, .shop-toolbar, .price-note, .fish-standards > div,' +
      ' .story-copy .eyebrow, .story-copy > p, .story-copy .button, .story-stat,' +
      ' .promise-section > .eyebrow, .promise-section > p, .promise-cards article,' +
      ' .review-mark, .review-quote, .review-by, .review-count,' +
      ' .newsletter > div > *, .newsletter form, .footer-main > *, .footer-bottom > *',
      'reveal',
      true,
    )

    tag('.hero-image-wrap, .shop-chooser-card, .product-photo, .story-image', 'img')

    /* A clipped element has no intersection area, so observe its parent as a proxy. */
    const proxyMap = new Map<Element, HTMLElement[]>()
    const addImageProxy = (target: HTMLElement) => {
      const proxy = target.parentElement || target
      proxy.setAttribute('data-fx-proxy', '')
      const targets = proxyMap.get(proxy) || []
      if (!targets.includes(target)) targets.push(target)
      proxyMap.set(proxy, targets)
      return proxy
    }
    qsa<HTMLElement>('[data-fx="img"]').forEach(addImageProxy)

    tag('.product-card', 'card', true)
    qsa<HTMLElement>('.product-card').forEach(card => { card.dataset.fxTilt = '' })
    tag('.admin-entry, .bag-button, .newsletter form button', 'glow')
    tag('.main-nav a', 'link')

    qsa<HTMLElement>('#shop .section-heading, #fish .fish-heading, .story-copy h2')
      .forEach(el => { el.dataset.fxBloom = '' })

    qsa<HTMLElement>('.promise-cards article > span').forEach(el => {
      el.dataset.fxScramble = ''
    })
    qsa<HTMLElement>('.review-stars, .review-count span').forEach(el => {
      el.dataset.fxStars = ''
    })
    qsa<HTMLElement>('.story-stat b').forEach(el => {
      if ((el.textContent || '').trim() !== '0') el.dataset.fxCount = ''
    })
    qsa<HTMLElement>('.hero-backdrop, .hero-image-wrap').forEach(el => {
      el.dataset.parallax = el.classList.contains('hero-backdrop') ? '14' : '10'
    })

    /* ---------- word splitter: keeps <em>, <br> and the original accessible text ---------- */
    const splitWords = (el: HTMLElement) => {
      if (el.dataset.fxSplit) return
      el.dataset.fxSplit = '1'
      const labelClone = el.cloneNode(true) as HTMLElement
      labelClone.querySelectorAll('br').forEach(br =>
        br.replaceWith(document.createTextNode(' ')),
      )
      el.setAttribute(
        'aria-label',
        (labelClone.textContent || '').replace(/\s+/g, ' ').trim(),
      )
      const walk = (node: Node) => {
        Array.from(node.childNodes).forEach(child => {
          if (child.nodeType === 3) {
            const text = child.textContent || ''
            if (!text.trim()) return
            const frag = document.createDocumentFragment()
            text.split(/(\s+)/).forEach(part => {
              if (!part.trim()) { frag.append(part); return }
              const outer = document.createElement('span')
              outer.className = 'w'
              outer.setAttribute('aria-hidden', 'true')
              const inner = document.createElement('span')
              inner.textContent = part
              outer.append(inner)
              frag.append(outer)
            })
            child.replaceWith(frag)
          } else if (child.nodeType === 1) {
            walk(child)
          }
        })
      }
      walk(el)
      el.querySelectorAll<HTMLElement>('.w > span')
        .forEach((span, i) => span.style.setProperty('--i', String(i)))
    }
    headings.forEach(splitWords)

    /* ---------- small text effects ---------- */
    const GLYPHS = '▯▮01/\\<>_-=+*#'
    const scramble = (el: HTMLElement) => {
      if (el.dataset.fxScrambled) return
      el.dataset.fxScrambled = '1'
      const final = el.textContent || ''
      if (!final) return
      let frame = 0
      const total = 18
      const id = window.setInterval(() => {
        frame++
        el.textContent = Array.from(final)
          .map((c, i) =>
            c === ' ' || i < final.length * frame / total
              ? c
              : GLYPHS[Math.floor(Math.random() * GLYPHS.length)],
          )
          .join('')
        if (frame >= total) {
          window.clearInterval(id)
          el.textContent = final
        }
      }, 40)
    }

    const splitStars = (el: HTMLElement) => {
      if (el.dataset.fxStarsSplit) return
      el.dataset.fxStarsSplit = '1'
      const text = el.textContent || ''
      el.setAttribute('aria-label', text)
      el.textContent = ''
      Array.from(text).forEach((char, i) => {
        const star = document.createElement('span')
        star.className = 's'
        star.textContent = char
        star.style.setProperty('--i', String(i))
        el.append(star)
      })
    }

    const countUp = (el: HTMLElement) => {
      if (el.dataset.fxCounted) return
      el.dataset.fxCounted = '1'
      const final = el.textContent || ''
      const match = final.match(/^(\D*)(\d+(?:\.\d+)?)(.*)$/)
      if (!match) return
      const [, prefix, number, suffix] = match
      const target = parseFloat(number)
      const decimals = number.includes('.') ? number.split('.')[1].length : 0
      const start = performance.now()
      const duration = 1100
      const step = (now: number) => {
        const p = Math.min(1, (now - start) / duration)
        const eased = 1 - Math.pow(1 - p, 3)
        el.textContent = prefix + (target * eased).toFixed(decimals) + suffix
        if (p < 1) requestAnimationFrame(step)
        else el.textContent = final
      }
      requestAnimationFrame(step)
    }

    /* ---------- one observer for reveals ---------- */
    const io = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return
        const el = entry.target as HTMLElement
        el.setAttribute('data-in', '')
        io.unobserve(el)
        if (el.dataset.fx === 'reveal' || el.dataset.fx === 'img' || el.dataset.fx === 'card') {
          window.setTimeout(() => { el.style.willChange = 'auto' }, 1500)
        }
        if (el.hasAttribute('data-fx-proxy')) {
          ;(proxyMap.get(el) || []).forEach(target => {
            target.setAttribute('data-in', '')
            window.setTimeout(() => { target.style.willChange = 'auto' }, 1500)
          })
        }
      })
    }, { threshold: 0.15, rootMargin: '0px 0px -8% 0px' })
    qsa('[data-fx], [data-fx-bloom], [data-fx-proxy]').forEach(el => io.observe(el))

    /* ---------- secondary observer for one-shot text details ---------- */
    const detailIO = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return
        const el = entry.target as HTMLElement
        if (el.hasAttribute('data-fx-scramble')) scramble(el)
        if (el.hasAttribute('data-fx-stars')) {
          splitStars(el)
          el.setAttribute('data-in', '')
        }
        if (el.hasAttribute('data-fx-count')) countUp(el)
        detailIO.unobserve(el)
      })
    }, { threshold: 0.6 })
    qsa('[data-fx-scramble], [data-fx-stars], [data-fx-count]')
      .forEach(el => detailIO.observe(el))

    /* ---------- one passive scroll handler for depth parallax ---------- */
    const parallax = qsa<HTMLElement>('[data-parallax]')
    let ticking = false
    const updateParallax = () => {
      const vh = window.innerHeight
      parallax.forEach(el => {
        const frame = el.parentElement || el
        const rect = frame.getBoundingClientRect()
        if (rect.bottom < 0 || rect.top > vh) return
        const p = (rect.top + rect.height / 2 - vh / 2) / vh
        const amount = Number(el.dataset.parallax || 40)
        el.style.transform =
          `translate3d(0,${(p * amount).toFixed(1)}px,0) scale(${(1 + Math.abs(p) * .03).toFixed(3)})`
      })
      ticking = false
    }
    const onScroll = () => {
      if (ticking) return
      ticking = true
      requestAnimationFrame(updateParallax)
    }
    window.addEventListener('scroll', onScroll, { passive: true, signal: sig })
    window.addEventListener('resize', updateParallax, { passive: true, signal: sig })
    updateParallax()

    /* ---------- pointer tilt (fine pointers only) ---------- */
    if (window.matchMedia('(hover:hover) and (pointer:fine)').matches) {
      qsa<HTMLElement>('[data-fx-tilt]').forEach(el => {
        const move = (event: PointerEvent) => {
          const rect = el.getBoundingClientRect()
          const x = (event.clientX - rect.left) / rect.width
          const y = (event.clientY - rect.top) / rect.height
          el.style.setProperty('--ry', ((x - .5) * 12).toFixed(2) + 'deg')
          el.style.setProperty('--rx', ((.5 - y) * 10).toFixed(2) + 'deg')
          el.style.setProperty('--mx', (x * 100).toFixed(1) + '%')
          el.style.setProperty('--my', (y * 100).toFixed(1) + '%')
        }
        const leave = () => {
          ;['--rx', '--ry', '--mx', '--my'].forEach(k => el.style.removeProperty(k))
        }
        el.addEventListener('pointermove', move, { signal: sig })
        el.addEventListener('pointerleave', leave, { signal: sig })
      })
    }

    /* ---------- re-tag cards that React replaces when filters/search change ---------- */
    const retagProducts = () => {
      qsa<HTMLElement>('.product-grid .product-card').forEach((card, i) => {
        if (!card.hasAttribute('data-fx')) {
          card.dataset.fx = 'card'
          card.style.setProperty('--i', String(i % 8))
        }
        if (!card.hasAttribute('data-fx-tilt')) card.dataset.fxTilt = ''
        const photo = card.querySelector<HTMLElement>('.product-photo')
        if (photo && !photo.hasAttribute('data-fx')) {
          photo.dataset.fx = 'img'
          io.observe(addImageProxy(photo))
        }
      })
    }
    const grids = qsa<HTMLElement>('.product-grid')
    const mutationObserver = new MutationObserver(retagProducts)
    grids.forEach(grid => mutationObserver.observe(grid, { childList: true }))
    const onFilterClick = (event: Event) => {
      const target = event.target as HTMLElement
      if (!target.closest('.category-tab, .sort-control')) return
      grids.forEach(grid => grid.setAttribute('data-fx-swap', ''))
      requestAnimationFrame(retagProducts)
    }
    document.addEventListener('click', onFilterClick, { signal: sig })

    /* ---------- ambient dust + light streak in the hero ---------- */
    const hero = document.querySelector<HTMLElement>('#home')
    let dustIO: IntersectionObserver | undefined
    let canvas: HTMLCanvasElement | undefined
    let streak: HTMLDivElement | undefined
    if (hero) {
      canvas = document.createElement('canvas')
      canvas.setAttribute('aria-hidden', 'true')
      Object.assign(canvas.style, {
        position: 'absolute', inset: '0', width: '100%', height: '100%',
        pointerEvents: 'none', zIndex: '0',
      })
      hero.appendChild(canvas)

      streak = document.createElement('div')
      streak.className = 'fx-streak'
      streak.setAttribute('aria-hidden', 'true')
      hero.appendChild(streak)

      const ctx = canvas.getContext('2d')
      if (ctx) {
        const dpr = Math.min(window.devicePixelRatio || 1, 2)
        const rgb = '198,147,81' /* existing --gold */
        let width = 0
        let height = 0
        let running = false
        let raf = 0
        const particles: Particle[] = []
        const resizeCanvas = () => {
          width = canvas!.width = Math.max(1, hero.clientWidth * dpr)
          height = canvas!.height = Math.max(1, hero.clientHeight * dpr)
        }
        resizeCanvas()
        window.addEventListener('resize', resizeCanvas, { passive: true, signal: sig })
        const count = window.innerWidth < 700 ? 30 : 70
        for (let i = 0; i < count; i++) {
          particles.push({
            x: Math.random(),
            y: Math.random(),
            r: (Math.random() * 1.4 + .4) * dpr,
            vx: (Math.random() - .5) * .00006,
            vy: -(Math.random() * .00012 + .00004),
            ph: Math.random() * 6.28,
          })
        }
        const draw = (time: number) => {
          if (!running) return
          ctx.clearRect(0, 0, width, height)
          particles.forEach(p => {
            p.x += p.vx
            p.y += p.vy
            if (p.y < -.02) { p.y = 1.02; p.x = Math.random() }
            ctx.fillStyle =
              `rgba(${rgb},${(.12 + .32 * Math.abs(Math.sin(time / 1800 + p.ph))).toFixed(2)})`
            ctx.beginPath()
            ctx.arc(p.x * width, p.y * height, p.r, 0, 6.283)
            ctx.fill()
          })
          raf = requestAnimationFrame(draw)
        }
        const setRunning = (next: boolean) => {
          running = next
          cancelAnimationFrame(raf)
          if (running) raf = requestAnimationFrame(draw)
        }
        dustIO = new IntersectionObserver(([entry]) => {
          setRunning(entry.isIntersecting && !document.hidden)
        }, { threshold: 0 })
        dustIO.observe(hero)
        document.addEventListener('visibilitychange', () => {
          setRunning(!document.hidden && hero.getBoundingClientRect().bottom > 0)
        }, { signal: sig })
      }
    }

    /* ---------- one-time loader (rendered by client state) ---------- */
    let loaderTimer: number | undefined
    try {
      if (!window.sessionStorage.getItem('fresh-farm-motion-seen')) {
        setLoader('show')
        loaderTimer = window.setTimeout(() => {
          try { window.sessionStorage.setItem('fresh-farm-motion-seen', '1') } catch { /* ignore */ }
          setLoader('done')
        }, 1300)
      }
    } catch { /* ignore storage restrictions */ }

    return () => {
      ac.abort()
      io.disconnect()
      detailIO.disconnect()
      dustIO?.disconnect()
      mutationObserver.disconnect()
      if (loaderTimer) window.clearTimeout(loaderTimer)
      canvas?.remove()
      streak?.remove()
      root.classList.remove('fx-on')
    }
  }, [])

  if (loader === 'none') return null

  return (
    <div className="fx-loader" data-done={loader === 'done' ? '' : undefined} aria-hidden="true">
      <svg width="78" height="78" viewBox="0 0 80 80" role="presentation">
        <path d="M20 40 C20 20 60 60 60 40 C60 20 20 60 20 40" />
      </svg>
      <strong>freshfarm</strong>
      <small>GOOD FOOD, GROWN WITH CARE</small>
    </div>
  )
}
