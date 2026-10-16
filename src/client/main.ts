import './styles.css';

const status = document.querySelector<HTMLParagraphElement>('#status');

async function checkServer(): Promise<void> {
  if (!status) return;
  try {
    const response = await fetch('/health', { cache: 'no-store' });
    status.textContent = response.ok
      ? 'Server is up. The lightning feed is not built yet.'
      : `Server answered ${response.status}.`;
  } catch {
    status.textContent = 'Server unreachable.';
  }
}

void checkServer();
