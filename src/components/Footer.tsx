export function Footer() {
  return (
    <footer className="border-t border-black/10 dark:border-white/10 mt-auto">
      <div className="max-w-6xl mx-auto px-4 py-6 text-sm text-black/60 dark:text-white/50 flex flex-col sm:flex-row justify-between gap-2">
        <span>© {new Date().getFullYear()} MARTKET. All rights reserved.</span>
        <span>Buy and sell locally, hassle-free.</span>
      </div>
    </footer>
  );
}
