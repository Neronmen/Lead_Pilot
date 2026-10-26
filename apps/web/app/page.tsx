import { redirect } from 'next/navigation';
import { DEFAULT_LANDING } from '@/lib/auth/safe-next';

// The app starts at the leads page; its session gate sends signed-out people to /login.
export default function HomePage() {
  redirect(DEFAULT_LANDING);
}
