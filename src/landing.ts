export const landingPageHtml = `<!doctype html>
<html lang="bg">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="theme-color" content="#08a4df">
    <meta
      name="description"
      content="Дигиталният бизнес асистент на Леон — надеждна информация за счетоводство, данъци и бизнес."
    >
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; img-src https://images.squarespace-cdn.com data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"
    >
    <title>Леон AI — дигитален бизнес асистент</title>
    <style>
      :root {
        color-scheme: light;
        --leon-blue: #08a4df;
        --leon-blue-deep: #087eae;
        --ink: #102b3a;
        --muted: #55717f;
        --paper: #f5fbfe;
        --accent: #e82d7c;
      }

      * { box-sizing: border-box; }

      html, body { min-height: 100%; }

      body {
        margin: 0;
        color: var(--ink);
        background:
          radial-gradient(circle at 10% 88%, rgb(232 45 124 / 10%), transparent 25rem),
          radial-gradient(circle at 90% 8%, rgb(8 164 223 / 22%), transparent 30rem),
          var(--paper);
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      .shell {
        min-height: 100vh;
        display: grid;
        grid-template-rows: auto 1fr auto;
        overflow: hidden;
      }

      header, main, footer {
        width: min(1120px, calc(100% - 40px));
        margin-inline: auto;
      }

      header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 24px;
        padding-block: 28px;
      }

      .brand {
        display: inline-flex;
        align-items: center;
        gap: 12px;
        color: var(--ink);
        text-decoration: none;
      }

      .brand-mark {
        display: grid;
        place-items: center;
        width: 112px;
        height: 52px;
        padding: 10px 14px;
        border-radius: 18px;
        background: var(--leon-blue);
        box-shadow: 0 12px 30px rgb(8 126 174 / 18%);
      }

      .brand-mark img { width: 100%; height: auto; display: block; }

      .brand-label {
        font-size: 12px;
        font-weight: 800;
        letter-spacing: .14em;
        text-transform: uppercase;
      }

      .status {
        display: inline-flex;
        align-items: center;
        gap: 9px;
        padding: 10px 15px;
        border: 1px solid rgb(16 43 58 / 10%);
        border-radius: 999px;
        background: rgb(255 255 255 / 78%);
        color: var(--muted);
        font-size: 13px;
        font-weight: 750;
        box-shadow: 0 10px 30px rgb(16 43 58 / 6%);
        backdrop-filter: blur(12px);
      }

      .status::before {
        content: "";
        width: 9px;
        height: 9px;
        border-radius: 50%;
        background: #21b46f;
        box-shadow: 0 0 0 5px rgb(33 180 111 / 12%);
      }

      main {
        display: grid;
        grid-template-columns: minmax(0, 1.05fr) minmax(340px, .95fr);
        align-items: center;
        gap: clamp(46px, 7vw, 100px);
        padding-block: clamp(48px, 8vh, 100px);
      }

      .eyebrow {
        margin: 0 0 18px;
        color: var(--leon-blue-deep);
        font-size: 13px;
        font-weight: 850;
        letter-spacing: .14em;
        text-transform: uppercase;
      }

      h1 {
        max-width: 720px;
        margin: 0;
        font-size: clamp(48px, 6.2vw, 82px);
        line-height: .98;
        letter-spacing: -.055em;
      }

      h1 span { color: var(--leon-blue); }

      .lead {
        max-width: 620px;
        margin: 28px 0 0;
        color: var(--muted);
        font-size: clamp(18px, 2vw, 22px);
        line-height: 1.55;
      }

      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        margin-top: 34px;
      }

      .button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 52px;
        padding: 0 24px;
        border: 1px solid rgb(16 43 58 / 14%);
        border-radius: 999px;
        color: var(--ink);
        background: white;
        font-size: 14px;
        font-weight: 850;
        text-decoration: none;
        transition: transform .18s ease, box-shadow .18s ease;
      }

      .button.primary {
        border-color: var(--leon-blue);
        color: white;
        background: var(--leon-blue);
        box-shadow: 0 16px 34px rgb(8 164 223 / 25%);
      }

      .button:hover { transform: translateY(-2px); box-shadow: 0 14px 28px rgb(16 43 58 / 12%); }
      .button:focus-visible { outline: 3px solid rgb(232 45 124 / 34%); outline-offset: 3px; }

      .chat-wrap { position: relative; isolation: isolate; }

      .chat-wrap::before {
        content: "";
        position: absolute;
        inset: 10% -10% -8% 8%;
        z-index: -1;
        border-radius: 42px;
        background: var(--leon-blue);
        transform: rotate(4deg);
        opacity: .13;
      }

      .chat {
        padding: 24px;
        border: 1px solid rgb(16 43 58 / 9%);
        border-radius: 32px;
        background: rgb(255 255 255 / 88%);
        box-shadow: 0 34px 80px rgb(16 43 58 / 14%);
        backdrop-filter: blur(18px);
      }

      .chat-head {
        display: flex;
        align-items: center;
        gap: 13px;
        padding-bottom: 20px;
        border-bottom: 1px solid rgb(16 43 58 / 8%);
      }

      .avatar {
        display: grid;
        place-items: center;
        width: 46px;
        height: 46px;
        border-radius: 16px;
        color: white;
        background: var(--leon-blue);
        font-size: 22px;
        font-weight: 900;
      }

      .chat-title { font-weight: 850; }
      .chat-subtitle { margin-top: 3px; color: var(--muted); font-size: 13px; }

      .messages { display: grid; gap: 14px; padding-top: 24px; }

      .message {
        max-width: 88%;
        padding: 14px 17px;
        border-radius: 18px;
        font-size: 15px;
        line-height: 1.5;
      }

      .message.user {
        justify-self: end;
        border-bottom-right-radius: 5px;
        color: white;
        background: var(--ink);
      }

      .message.assistant {
        border-bottom-left-radius: 5px;
        background: #eaf7fc;
      }

      .source {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-top: 10px;
        color: var(--leon-blue-deep);
        font-size: 12px;
        font-weight: 800;
      }

      .source::before { content: "✓"; }

      footer {
        display: flex;
        justify-content: space-between;
        gap: 20px;
        padding-block: 24px 32px;
        color: var(--muted);
        font-size: 12px;
      }

      footer a { color: inherit; }

      @media (max-width: 820px) {
        main { grid-template-columns: 1fr; padding-top: 32px; }
        .copy { text-align: center; }
        .lead { margin-inline: auto; }
        .actions { justify-content: center; }
        .chat-wrap { width: min(100%, 520px); margin-inline: auto; }
        .brand-label { display: none; }
      }

      @media (max-width: 480px) {
        header, main, footer { width: min(100% - 28px, 1120px); }
        header { padding-top: 18px; }
        .brand-mark { width: 94px; height: 46px; }
        .status { padding: 9px 12px; font-size: 12px; }
        h1 { font-size: 45px; }
        .chat { padding: 18px; border-radius: 24px; }
        footer { flex-direction: column; text-align: center; }
      }

      @media (prefers-reduced-motion: reduce) {
        .button { transition: none; }
      }
    </style>
  </head>
  <body>
    <div class="shell">
      <header>
        <a class="brand" href="https://leon.bg/" rel="noreferrer">
          <span class="brand-mark">
            <img
              src="https://images.squarespace-cdn.com/content/v1/661e23d58de0ce6f79d2b77f/d2a6e811-5222-40c8-89d3-b88ae009d639/leon-logo-inverted-rgb-900px-w-72ppi.png?format=500w"
              alt="Леон"
            >
          </span>
          <span class="brand-label">Дигитално счетоводство</span>
        </a>
        <div class="status">Услугата е онлайн</div>
      </header>

      <main>
        <section class="copy">
          <p class="eyebrow">Новият дигитален помощник на Леон</p>
          <h1>Бизнес въпросите ти имат <span>ясен отговор.</span></h1>
          <p class="lead">
            Асистент за счетоводство, данъци и бизнес, който работи с подбрани източници и знанията на Леон.
          </p>
          <div class="actions">
            <a class="button primary" href="https://leon.bg/" rel="noreferrer">Научи повече за Леон</a>
            <a class="button" href="https://ems.leon.bg/" rel="noreferrer">Вход в LEMS</a>
          </div>
        </section>

        <section class="chat-wrap" aria-label="Примерен разговор с асистента">
          <div class="chat">
            <div class="chat-head">
              <div class="avatar" aria-hidden="true">L</div>
              <div>
                <div class="chat-title">Леон AI</div>
                <div class="chat-subtitle">Дигитален бизнес асистент</div>
              </div>
            </div>
            <div class="messages">
              <div class="message user">Може ли да ми помогнеш със счетоводен въпрос?</div>
              <div class="message assistant">
                Разбира се. Ще потърся отговор в надеждните източници и ще ти покажа на какво се основава.
                <div class="source">Отговор с проверими източници</div>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer>
        <span>© 2026 Леон Счетоводни услуги</span>
        <span>Създадено за по-лесен бизнес.</span>
      </footer>
    </div>
  </body>
</html>`;
