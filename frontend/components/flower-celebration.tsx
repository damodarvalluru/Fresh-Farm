'use client'

import { useEffect, useMemo, useState } from 'react'

const COLORS = ['#e8a0b4', '#f2c14e', '#e76f51', '#c7d8a3', '#f5e6c8', '#d98ca0', '#f4a261']

/**
 * Lightweight CSS celebration shown after an order is confirmed. It renders
 * once, animates with GPU-friendly transforms, and removes itself so it never
 * delays interaction or leaks DOM nodes.
 */
export function FlowerCelebration({ active, onDone }: { active: boolean; onDone?: () => void }) {
  const [visible, setVisible] = useState(active)

  useEffect(() => {
    if (!active) { setVisible(false); return }
    setVisible(true)
    const timer = window.setTimeout(() => { setVisible(false); onDone?.() }, 4200)
    return () => window.clearTimeout(timer)
  }, [active, onDone])

  const petals = useMemo(() => Array.from({ length: 42 }, (_, index) => ({
    id: index,
    left: (index * 37 + 11) % 100,
    delay: (index % 12) * 0.12,
    duration: 2.4 + (index % 7) * 0.28,
    size: 10 + (index % 5) * 4,
    rotate: (index * 47) % 360,
    color: COLORS[index % COLORS.length],
    drift: ((index % 9) - 4) * 18,
    round: index % 3 === 0,
  })), [])

  if (!visible) return null
  return <div className="flower-celebration" aria-hidden="true">
    <div className="flower-bloom">
      {Array.from({ length: 10 }, (_, index) => <span key={index} style={{ ['--i' as string]: index, background: COLORS[index % COLORS.length] }} />)}
      <b>Order confirmed</b>
    </div>
    {petals.map(petal => <span
      key={petal.id}
      className={petal.round ? 'petal petal-round' : 'petal'}
      style={{
        left: `${petal.left}%`,
        width: petal.size,
        height: petal.size * (petal.round ? 1 : 1.5),
        background: petal.color,
        animationDelay: `${petal.delay}s`,
        animationDuration: `${petal.duration}s`,
        ['--drift' as string]: `${petal.drift}px`,
        ['--spin' as string]: `${petal.rotate}deg`,
      }}
    />)}
  </div>
}
