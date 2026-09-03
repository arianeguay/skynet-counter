import { redirect } from 'next/navigation';
import { DEFAULT_DOMAIN } from '@/lib/domains';

// The counters all live under `/<slug>`; the root is the default one rather than
// a fifth copy of the page that would have to be kept in step with it.
export default function Home() {
  redirect(`/${DEFAULT_DOMAIN}`);
}
