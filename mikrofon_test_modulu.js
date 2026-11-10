
class VoiceMicCheck extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this.stream = null;
    this.recorder = null;
    this.chunks = [];
    this.model = null;
    this.running = false;
    this.startedAt = 0;
    this.timer = null;
  }

  connectedCallback() {
    this.shadowRoot.innerHTML = `
      <style>
        * { box-sizing: border-box; }
        .app {
          max-width: 720px; margin: auto; padding: 22px;
          font-family: Arial, sans-serif; color: #202938;
          background: white; border: 1px solid #e2e8f0;
          border-radius: 16px;
        }
        h2 { margin-top: 0; }
        .status {
          padding: 13px; background: #f1f5f9;
          border-radius: 9px; font-size: 14px;
          line-height: 1.6; margin: 16px 0;
        }
        button {
          border: 0; padding: 14px 20px; margin: 4px;
          border-radius: 9px; font-size: 16px;
          font-weight: bold; cursor: pointer;
        }
        #start { background: #16834b; color: white; }
        #stop { background: #b91c1c; color: white; }
        button:disabled { opacity: .4; cursor: not-allowed; }
        .passage {
          background: #f8fafc; padding: 17px;
          border: 1px solid #e2e8f0; border-radius: 10px;
          font-size: 18px; line-height: 1.8;
        }
        #transcript {
          min-height: 110px; padding: 15px;
          border: 1px solid #e2e8f0; border-radius: 10px;
          line-height: 1.8; overflow-wrap: anywhere;
        }
        .stats {
          display: grid; grid-template-columns: repeat(2,1fr);
          gap: 10px; margin-top: 15px;
        }
        .stat { background: #f8fafc; padding: 13px; border-radius: 9px; }
        .stat small { display: block; color: #64748b; margin-bottom: 7px; }
        .stat strong { font-size: 22px; }
        .good { color: #16834b; }
        .bad { color: #dc3545; }
        .missing { color: #d97706; }
        .extra { color: #7c3aed; }
        #analysis { line-height: 2; overflow-wrap: anywhere; }
        @media(max-width:480px) {
          .app { padding: 15px; }
          .passage { font-size: 17px; }
          button { width: 100%; margin: 5px 0; }
        }
      </style>

      <div class="app">
        <h2>Türkçe Sesli Okuma Testi</h2>
        <p>Metni sesli okuyun. Sesiniz cihazınızda işlenecektir.</p>

        <div class="passage" id="passage">
          Sağlıklı olmak için dengeli beslenmeli ve düzenli uyumalıyız.
          Her gün hareket etmek, temiz hava almak ve bol su içmek
          vücudumuz için önemlidir. Sağlıklı çocuklar oyun oynarken
          ve ders çalışırken kendilerini daha iyi hissederler.
        </div>

        <div class="status" id="status">Model yükleniyor...</div>

        <button id="start" disabled>Okumayı Başlat</button>
        <button id="stop" disabled>Okumayı Bitir</button>

        <h3>Algılanan konuşma</h3>
        <div id="transcript">Henüz konuşma algılanmadı.</div>

        <div class="stats">
          <div class="stat"><small>Okuma süresi</small><strong id="duration">0 sn</strong></div>
          <div class="stat"><small>Doğruluk</small><strong id="accuracy">-%</strong></div>
          <div class="stat"><small>Doğru kelime</small><strong id="correct">0</strong></div>
          <div class="stat"><small>Yanlış kelime</small><strong id="wrong">0</strong></div>
          <div class="stat"><small>Atlanan kelime</small><strong id="skipped">0</strong></div>
          <div class="stat"><small>Doğru kelime/dk</small><strong id="wpm">0</strong></div>
        </div>

        <h3>Kelime analizi</h3>
        <div id="analysis">Henüz analiz yapılmadı.</div>
      </div>
    `;

    this.$ = id => this.shadowRoot.getElementById(id);
    this.$("start").addEventListener("click", () => this.startReading());
    this.$("stop").addEventListener("click", () => this.stopReading());

    this.loadModel();
  }

  normalize(text) {
    return text.toLocaleLowerCase("tr-TR")
      .replace(/[.,!?;:"“”()]/g, "")
      .replace(/\s+/g, " ").trim();
  }

  async loadModel() {
    try {
      this.$("status").textContent = "Ses tanıma kütüphanesi yükleniyor...";

      const { pipeline, env } = await import(
        "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.2"
      );

      env.allowLocalModels = false;
      env.useBrowserCache = true;

      this.$("status").textContent =
        "Türkçe ses modeli indiriliyor. İlk yükleme uzun sürebilir...";

      this.model = await pipeline(
        "automatic-speech-recognition",
        "Xenova/whisper-base",
        { dtype: "q8" }
      );

      this.$("status").textContent =
        "Model hazır. Okumaya başlayabilirsiniz.";

      this.$("start").disabled = false;
    } catch (error) {
      this.showError("Model yüklenemedi: " + error.message);
    }
  }

  async startReading() {
    if (!this.model || this.running) return;

    try {
      this.$("start").disabled = true;
      this.$("transcript").textContent = "";
      this.$("analysis").textContent = "Okuma devam ediyor...";

      this.$("status").textContent = "Mikrofon izni bekleniyor...";

      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });

      const mimeTypes = [
        "audio/mp4",
        "audio/webm;codecs=opus",
        "audio/webm"
      ];

      const mimeType = mimeTypes.find(type =>
        MediaRecorder.isTypeSupported(type)
      );

      this.chunks = [];

      this.recorder = new MediaRecorder(
        this.stream,
        mimeType ? { mimeType } : undefined
      );

      this.recorder.ondataavailable = event => {
        if (event.data && event.data.size > 0) {
          this.chunks.push(event.data);
        }
      };

      this.recorder.start();
      this.startedAt = Date.now();
      this.running = true;

      this.$("start").disabled = true;
      this.$("stop").disabled = false;

      this.$("status").textContent =
        "Mikrofon açık. Metni okumaya başlayabilirsiniz.";

      this.timer = setInterval(() => {
        this.$("duration").textContent =
          Math.floor((Date.now() - this.startedAt) / 1000) + " sn";
      }, 500);

    } catch (error) {
      this.showError("Mikrofon açılamadı: " + error.message);
      this.cleanup();
      this.$("start").disabled = false;
    }
  }

  async stopReading() {
    if (!this.running) return;

    this.running = false;
    clearInterval(this.timer);
    this.$("stop").disabled = true;
    this.$("status").textContent = "Ses kaydı hazırlanıyor...";

    try {
      await new Promise(resolve => {
        this.recorder.onstop = resolve;
        this.recorder.stop();
      });

      const blob = new Blob(this.chunks, {
        type: this.recorder.mimeType || "audio/mp4"
      });

      if (!blob.size) {
        throw new Error("Ses kaydı boş.");
      }

      this.$("status").textContent =
        "Ses Türkçe modelle çözümleniyor...";

      const audioContext = new (
        window.AudioContext || window.webkitAudioContext
      )();

      const audioBuffer = await audioContext.decodeAudioData(
        await blob.arrayBuffer()
      );

      const input = audioBuffer.getChannelData(0);
      const targetLength = Math.floor(
        input.length * 16000 / audioBuffer.sampleRate
      );

      const audio = new Float32Array(targetLength);

      for (let i = 0; i < targetLength; i++) {
        const position = i * audioBuffer.sampleRate / 16000;
        const left = Math.floor(position);
        const right = Math.min(left + 1, input.length - 1);
        const fraction = position - left;

        audio[i] =
          input[left] * (1 - fraction) +
          input[right] * fraction;
      }

      await audioContext.close();

      const result = await this.model(audio, {
        language: "turkish",
        task: "transcribe"
      });

      const text = this.normalize(result.text || "");

      if (!text) {
        throw new Error("Konuşma algılanamadı.");
      }

      this.$("transcript").textContent = text;
      this.compare(text);

      this.$("status").textContent = "Analiz tamamlandı.";

    } catch (error) {
      this.showError("Ses çözümleme hatası: " + error.message);
    } finally {
      this.cleanup();
      this.$("start").disabled = false;
    }
  }

  compare(text) {
    const source = this.normalize(this.$("passage").textContent).split(" ");
    const heard = this.normalize(text).split(" ");

    const dp = Array.from(
      { length: source.length + 1 },
      () => Array(heard.length + 1).fill(0)
    );

    for (let i = 0; i <= source.length; i++) dp[i][0] = i;
    for (let j = 0; j <= heard.length; j++) dp[0][j] = j;

    for (let i = 1; i <= source.length; i++) {
      for (let j = 1; j <= heard.length; j++) {
        dp[i][j] = source[i - 1] === heard[j - 1]
          ? dp[i - 1][j - 1]
          : Math.min(
              dp[i - 1][j] + 1,
              dp[i][j - 1] + 1,
              dp[i - 1][j - 1] + 1
            );
      }
    }

    let i = source.length;
    let j = heard.length;
    const operations = [];

    while (i || j) {
      if (i && j && source[i - 1] === heard[j - 1]) {
        operations.unshift({ type: "good", word: source[i - 1] });
        i--; j--;
      } else if (i && j && dp[i][j] === dp[i - 1][j - 1] + 1) {
        operations.unshift({ type: "bad", word: source[i - 1] });
        i--; j--;
      } else if (i && dp[i][j] === dp[i - 1][j] + 1) {
        operations.unshift({ type: "missing", word: source[i - 1] });
        i--;
      } else {
        operations.unshift({ type: "extra", word: heard[j - 1] });
        j--;
      }
    }

    const count = type =>
      operations.filter(item => item.type === type).length;

    const correct = count("good");
    const wrong = count("bad");
    const skipped = count("missing");
    const extra = count("extra");

    const seconds = Math.max(
      1,
      Math.round((Date.now() - this.startedAt) / 1000)
    );

    this.$("correct").textContent = correct;
    this.$("wrong").textContent = wrong;
    this.$("skipped").textContent = skipped;
    this.$("accuracy").textContent =
      Math.round(correct / source.length * 100) + "%";
    this.$("wpm").textContent =
      Math.round(correct * 60 / seconds);

    this.$("analysis").innerHTML = operations.map(item =>
      `<span class="${item.type}">${item.word}</span>`
    ).join(" ") +
      (extra
        ? "<br>Fazladan kelimeler: " +
          operations.filter(item => item.type === "extra")
            .map(item => item.word).join(", ")
        : "");
  }

  cleanup() {
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }

    this.recorder = null;
  }

  showError(message) {
    this.$("status").textContent = message;
    console.error(message);
  }
}

if (!customElements.get("voice-mic-check")) {
  customElements.define("voice-mic-check", VoiceMicCheck);
}
