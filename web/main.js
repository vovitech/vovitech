import './style.css'

document.querySelector('#app').innerHTML = `
  <div class="container">
    <header class="hero">
      <div class="badge">Innovation First</div>
      <h1>Vovitech</h1>
      <p class="subtitle">Spec-Driven Innovation for iOS and Cloud</p>
    </header>

    <main class="grid">
      <section class="card">
        <div class="icon">📱</div>
        <h3>iOS Mastery</h3>
        <p>Building high-performance, native experiences that push the boundaries of Apple's ecosystem.</p>
      </section>

      <section class="card">
        <div class="icon">☁️</div>
        <h3>Cloud Scale</h3>
        <p>Robust backend infrastructure designed for seamless integration and global scalability.</p>
      </section>

      <section class="card">
        <div class="icon">⚙️</div>
        <h3>Spec-Driven</h3>
        <p>Architecture guided by rigorous specifications to ensure reliability and maintainability.</p>
      </section>
    </main>

    <footer class="footer">
      <p>&copy; 2024 Vovitech. All rights reserved.</p>
    </footer>
  </div>
`
