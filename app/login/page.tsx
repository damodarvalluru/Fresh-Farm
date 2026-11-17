import type { Metadata } from 'next'
import { CustomerAuth } from '@/components/auth-screens'

export const metadata: Metadata = {
  title: 'Sign In | Fresh Farm',
  description: 'Sign in to your Fresh Farm account to track orders, keep your details handy and reorder your favourites.',
}

export default function LoginPage() { return <CustomerAuth mode="login" /> }
