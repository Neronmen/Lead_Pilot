import { redirect } from 'next/navigation';

// Settings opens on its first page (more arrive in later milestones).
export default function SettingsIndex() {
  redirect('/settings/sources');
}
