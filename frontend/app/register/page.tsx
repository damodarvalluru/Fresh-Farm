import type { Metadata } from 'next'
import { CustomerAuth } from '@/components/auth-screens'

export const metadata: Metadata = {
  title: 'Create an Account | Fresh Farm',
  description: 'Create a Fresh Farm account to order fresh chicken and fish, save your details and follow every delivery.',
}

export default function RegisterPage() { return <CustomerAuth mode="register" /> }
