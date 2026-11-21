const methodStages = document.querySelector('.method-stages');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

if (methodStages && 'IntersectionObserver' in window) {
  const stages = Array.from(methodStages.children);
  const revealThreshold = .34;
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) {
        entry.target.classList.remove('is-in-view');
      } else if (entry.intersectionRatio >= revealThreshold) {
        entry.target.classList.add('is-in-view');
      }
    }
  }, { threshold: [0, revealThreshold] });

  function updateMotion() {
    observer.disconnect();
    methodStages.classList.toggle('scroll-reveal', !reducedMotion.matches);
    for (const stage of stages) {
      stage.classList.remove('is-in-view');
      if (!reducedMotion.matches) observer.observe(stage);
    }
  }

  reducedMotion.addEventListener('change', updateMotion);
  updateMotion();
}
