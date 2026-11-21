const methodStages = document.querySelector('.method-stages');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

if (methodStages && !reducedMotion.matches && 'IntersectionObserver' in window) {
  const observer = new IntersectionObserver(([entry]) => {
    if (!entry.isIntersecting) return;
    observer.disconnect();
    if (reducedMotion.matches) return;

    Array.from(methodStages.children).forEach((stage, index) => {
      stage.animate(
        [{ opacity: 0, transform: 'translateY(9px)' }, { opacity: 1, transform: 'translateY(0)' }],
        { duration: 420, delay: index * 240, easing: 'ease-out', fill: 'backwards' }
      );
    });
  }, { threshold: .16 });
  observer.observe(methodStages);
}
