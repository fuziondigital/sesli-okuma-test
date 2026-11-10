
class VoiceMicCheck extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this.stream = null;
    this.recorder = null;
    this.chunks = [];
    this.transcriber = null;
  }

  connectedCallback() {
    this.shadowRoot.innerHTML = `
      <style>
        :host{display:block;width:100%;font-family:Arial,sans-serif;color:#172033}
        *{box-sizing:border-box}
        .panel{padding:22px;border:1px solid #dce3ed;border-radius:16px;background:#fff;max-width:760px;margin:auto}
        h2{margin:0 0 8px;font-size:22px}
        p{margin:0 0 16px;color:#5d6878;font-size:14px;line-height:1.55}
        .status{padding:13px;border-radius:10px;background:#f1f5f9;color:#334155;font-size:14px;line-height:1.5;min-height:46px}
        .actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:15px}
        button{border:0;border-radius:10px;padding:14px 18px;font-size:15px;font-weight:700;cursor:pointer}
        button:disabled{opacity:.45;cursor:not-allowed}
        #start{background:#166534;color:white}
        #stop{background:#b91c1c;color:white}
        .meta{margin-top:12px;color:#475569;font-size:13px;line-height:1.5}
        .result{margin-top:16px;padding:14px;border:1px solid #dce3ed;border-radius:10px;background:#fbfdff}
        .result h3{font-size:15px;margin:0 0 8px}
        .transcript{white-space:pre-wrap;line-height:1.6;font-size:15px}
        .hint{margin-top:14px;font-size:12px;color:#64748b;line-height:1.5}
        .bar{height:7px;background:#e2e8f0;border-radius:99px;overflow:hidden;margin-top:12px}
        .bar span{display:block;height:100%;width:0;background:#2563eb}
      </style>
      <section class="panel">
        <h2>Türkçe Ses Tanıma Testi</h2>
        <p>Mikrofonu başlatın, kısa bir Türkçe cümle okuyun ve okumayı bitirin.</p>
        <div class="status" id="status">Hazır. İlk kullanımda ses tanıma modeli indirilecektir.</div>
        <div class="bar" id="bar" hidden><span id="progress"></span></div>
        <div class="actions">
          <button id="start" type="button">Okumayı Başlat</button>
          <button id="stop" type="button" disabled>Okumayı Bitir</button>
        </div>
        <div class="meta" id="meta">İlk model indirmesi zaman alabilir.</div>
        <section class="result" id="result" hidden>
          <h3>Algılanan metin</h3>
          <div class="transcript" id="transcript"></div>
        </section>
        <div class="hint">Ses cihazda çözümlenir. Ses oynatıcısı bulunmaz. Bu prototip henüz kelime hata puanlaması yapmaz.</div>
      </section>`;

    this.$status = this.shadowRoot.querySelector("#status");
    this.$start = this.shadowRoot.querySelector("#start");
    this.$stop = this.shadowRoot.querySelector("#stop");
    this.$meta = this.shadowRoot.querySelector("#meta");
    this.$result = this.shadowRoot.querySelector("#result");
    this.$transcript = this.shadowRoot.querySelector("#transcript");
    this.$bar = this.shadowRoot.querySelector("#bar");
    this.$progress = this.shadowRoot.querySelector("#progress");

    this.$start.addEventListener("click", () => this.startRecording());
    this.$stop.addEventListener("click", () => this.stopRecording());
  }

  setStatus(text) {
    this.$status.textContent = text;
  }

  async loadModel() {
    if (this.transcriber) return this.transcriber;

    this.setStatus("Türkçe ses modeli indiriliyor...");
    this.$bar.hidden = false;

    const { pipeline, env } = await import(
      "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.2"
    );

    env.allowLocalModels = false;
    env.useBrowserCache = true;

    this.transcriber = await pipeline(
      "automatic-speech-recognition",
      "Xenova/whisper-tiny",
      {
        dtype: "q8",
        progress_callback: event => {
          if (typeof event?.progress === "number") {
            this.$progress.style.width =
              `${Math.min(100, event.progress)}%`;
            if (event.file) {
              this.$meta.textContent = `İndiriliyor: ${event.file}`;
            }
          }
        }
      }
    );

    this.setStatus("Ses modeli hazır.");
    return this.transcriber;
  }

  async startRecording() {
    if (!navigator.mediaDevices?.getUserMedia ||
        !window.MediaRecorder) {
      this.setStatus("Tarayıcı mikrofon kaydını desteklemiyor veya HTTPS gerekli.");
      return;
    }

    try {
      this.$start.disabled = true;
      await this.loadModel();

      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });

      this.chunks = [];

      const formats = [
        "audio/webm;codecs=opus",
        "audio/mp4",
        "audio/webm",
        "audio/ogg;codecs=opus"
      ];

      const mimeType = formats.find(
        type => MediaRecorder.isTypeSupported(type)
      );

      this.recorder = new MediaRecorder(
        this.stream,
        mimeType ? { mimeType } : undefined
      );

      this.recorder.ondataavailable = event => {
        if (event.data?.size) this.chunks.push(event.data);
      };

      this.recorder.onstop = () => this.transcribeRecording();

      this.startedAt = Date.now();
      this.recorder.start(500);

      this.$stop.disabled = false;
      this.$result.hidden = true;
      this.setStatus("Okuma başladı. Metni sesli okuyun.");
      this.$meta.textContent = "Okumanız bitince Okumayı Bitir'e basın.";

    } catch (error) {
      const messages = {
        NotAllowedError: "Mikrofon izni reddedildi veya Wix iframe izni engelliyor.",
        NotFoundError: "Mikrofon bulunamadı.",
        NotReadableError: "Mikrofon başka bir uygulama tarafından kullanılıyor.",
        SecurityError: "HTTPS veya mikrofon izinlerini kontrol edin."
      };

      this.setStatus(
        messages[error.name] ||
        `Başlatılamadı: ${error.message || error.name}`
      );

      this.$start.disabled = false;
      this.$stop.disabled = true;
      this.stopTracks();
    }
  }

  stopRecording() {
    if (this.recorder && this.recorder.state !== "inactive") {
      this.recorder.stop();
      this.$stop.disabled = true;
      this.setStatus("Konuşma metne dönüştürülüyor...");
    }
  }

  async convertAudio(blob) {
    const AudioContextClass =
      window.AudioContext || window.webkitAudioContext;

    if (!AudioContextClass) {
      throw new Error("Ses çözümleme desteklenmiyor.");
    }

    const context = new AudioContextClass();

    try {
      const decoded = await context.decodeAudioData(
        await blob.arrayBuffer()
      );

      const length = decoded.length;
      const mono = new Float32Array(length);

      for (let i = 0; i < length; i++) {
        let sum = 0;

        for (let c = 0; c < decoded.numberOfChannels; c++) {
          sum += decoded.getChannelData(c)[i];
        }

        mono[i] = sum / decoded.numberOfChannels;
      }

      const outputLength = Math.max(
        1,
        Math.round(length * 16000 / decoded.sampleRate)
      );

      const output = new Float32Array(outputLength);
      const ratio = decoded.sampleRate / 16000;

      for (let i = 0; i < outputLength; i++) {
        const position = i * ratio;
        const left = Math.floor(position);
        const right = Math.min(left + 1, length - 1);
        const fraction = position - left;

        output[i] =
          mono[left] * (1 - fraction) +
          mono[right] * fraction;
      }

      return output;
    } finally {
      await context.close();
    }
  }

  async transcribeRecording() {
    const duration = (Date.now() - this.startedAt) / 1000;

    const blob = new Blob(this.chunks, {
      type: this.recorder?.mimeType || "audio/webm"
    });

    this.stopTracks();
    this.chunks = [];

    this.$start.disabled = true;
    this.setStatus("Ses cihazda çözümleniyor...");

    try {
      const audio = await this.convertAudio(blob);

      const result = await this.transcriber(audio, {
        language: "turkish",
        task: "transcribe",
        chunk_length_s: 30,
        stride_length_s: 5
      });

      const text = (result?.text || "").trim();

      this.$transcript.textContent =
        text || "Konuşma algılanamadı. Tekrar deneyin.";

      this.$result.hidden = false;

      this.setStatus("Konuşma metne dönüştürüldü.");

      this.$meta.textContent =
        `Okuma süresi: ${duration.toFixed(1)} saniye · ` +
        `Algılanan kelime: ${text ? text.trim().split(/\s+/).length : 0}`;

      this.dispatchEvent(new CustomEvent(
        "voice-transcription-complete",
        {
          detail: {
            text,
            durationSeconds: duration
          },
          bubbles: true,
          composed: true
        }
      ));

    } catch (error) {
      this.setStatus(
        `Ses çözümlenemedi: ${error.message || error}`
      );
    } finally {
      this.$start.disabled = false;
      this.$stop.disabled = true;
      this.recorder = null;
    }
  }

  stopTracks() {
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }
  }

  disconnectedCallback() {
    this.stopTracks();
  }
}

if (!customElements.get("voice-mic-check")) {
  customElements.define("voice-mic-check", VoiceMicCheck);
}
