class BackgroundManager {
  constructor() {
    this.container = document.createElement("div");
    this.container.id = "background-container";
    document.body.appendChild(this.container);
    this.initParticles();
  }

  initParticles() {
    const canvas = document.createElement("div");
    canvas.className = "particles-canvas";

    const numParticles = 24;
    for (let i = 0; i < numParticles; i++) {
      const p = document.createElement("div");
      p.className = "particle";
      const size = Math.random() * 6 + 3;
      p.style.width = `${size}px`;
      p.style.height = `${size}px`;
      p.style.left = `${Math.random() * 100}%`;

      const duration = Math.random() * 8 + 12;
      const delay = Math.random() * -20;
      p.style.animationDuration = `${duration}s`;
      p.style.animationDelay = `${delay}s`;

      canvas.appendChild(p);
    }

    this.container.appendChild(canvas);
  }
}

window.backgroundManager = new BackgroundManager();

