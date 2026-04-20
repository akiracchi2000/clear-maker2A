// Configuration
// 同じディレクトリのbackend_GAS.gsのURL
const GAS_API_URL = 'https://script.google.com/macros/s/AKfycbwT8ED1qE-4gqRGM-y4xup-K9lSt3S7CanT9n24OIpT5sI7m4kkb09mOG5PHX4bjlPi/exec';

// State
let state = {
    studentId: '',
    images: [], // Array of { mimeType, data }
};
let problemData = {};

// DOM Elements
const els = {
    setupModal: document.getElementById('setup-modal'),
    studentIdInput: document.getElementById('student-id'),
    roundSelect: document.getElementById('round-select'),
    problemSelect: document.getElementById('problem-select'),
    saveSetupBtn: document.getElementById('save-setup-btn'),
    userInfo: document.getElementById('user-info'),
    displayStudentId: document.getElementById('display-student-id'),
    settingsBtn: document.getElementById('settings-btn'),

    cameraInput: document.getElementById('camera-input'),
    uploadBtn: document.getElementById('upload-btn'),
    previewContainer: document.getElementById('preview-container'),
    imagePreviewList: document.getElementById('image-preview-list'),
    addMoreBtn: document.getElementById('add-more-btn'),
    clearAllBtn: document.getElementById('clear-all-btn'),

    evaluateBtn: document.getElementById('evaluate-btn'),
    loadingIndicator: document.getElementById('loading-indicator'),
    
    resultSection: document.getElementById('result-section'),
    resultBadge: document.getElementById('result-badge'),
    resultContent: document.getElementById('result-content'),
    newQuestionBtn: document.getElementById('new-question-btn'),

    // Camera Modal Elements
    cameraModal: document.getElementById('camera-modal'),
    cameraVideo: document.getElementById('camera-video'),
    cameraCanvas: document.getElementById('camera-canvas'),
    cameraShutterBtn: document.getElementById('camera-shutter-btn'),
    cameraSwitchBtn: document.getElementById('camera-switch-btn'),
    cameraCloseBtn: document.getElementById('camera-close-btn'),
};

// Camera State
let cameraState = {
    stream: null,
    facingMode: 'environment', // 'user' or 'environment'
};

// Initialization
function init() {
    state.studentId = localStorage.getItem('student_id') || '';
    
    if (!state.studentId) {
        els.setupModal.classList.remove('hidden');
    } else {
        updateUserInfo();
    }

    setupEventListeners();
    fetchAndSetupProblems();
}

async function fetchAndSetupProblems() {
    els.roundSelect.innerHTML = '<option value="">-- データ読込中... --</option>';
    els.roundSelect.disabled = true;
    els.problemSelect.disabled = true;

    try {
        const payload = { action: "getProblems" };
        const response = await fetch(GAS_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify(payload)
        });
        const json = await response.json();
        
        if (json.status === "success" && json.data) {
            problemData = json.data;
            
            // Populate roundSelect
            els.roundSelect.innerHTML = '<option value="">-- 回を選択 --</option>';
            for (const round in problemData) {
                const opt = document.createElement('option');
                opt.value = round;
                opt.textContent = round;
                els.roundSelect.appendChild(opt);
            }
            els.roundSelect.disabled = false;
        } else {
            throw new Error((json.error || "データ取得失敗"));
        }
    } catch (e) {
        console.error(e);
        els.roundSelect.innerHTML = '<option value="">-- 読込失敗 --</option>';
    }
}

function updateUserInfo() {
    if (state.studentId) {
        els.displayStudentId.textContent = state.studentId;
        els.userInfo.classList.remove('hidden');
    }
}

function setupEventListeners() {
    // Cascaded Dropdown Logic
    els.roundSelect.addEventListener('change', (e) => {
        const round = e.target.value;
        els.problemSelect.innerHTML = '<option value="">-- 問題を選択 --</option>';
        if (round && problemData[round]) {
            problemData[round].forEach(p => {
                const opt = document.createElement('option');
                opt.value = p.id;
                opt.textContent = p.label;
                els.problemSelect.appendChild(opt);
            });
            els.problemSelect.disabled = false;
        } else {
            els.problemSelect.disabled = true;
        }
    });

    // Modal
    els.saveSetupBtn.addEventListener('click', () => {
        const id = els.studentIdInput.value.trim();
        if (id) {
            state.studentId = id;
            localStorage.setItem('student_id', id);
            updateUserInfo();
            els.setupModal.classList.add('hidden');
        } else {
            alert('生徒番号を入力してください。');
        }
    });

    els.settingsBtn.addEventListener('click', () => {
        els.studentIdInput.value = state.studentId;
        els.setupModal.classList.remove('hidden');
    });

    // モーダルの外側（背景）をクリックした時に閉じる
    els.setupModal.addEventListener('click', (e) => {
        // e.target がモーダルの背景部分そのものである場合のみ
        if (e.target === els.setupModal) {
            // すでに生徒番号が登録されている場合のみ閉じられる（初回強制入力用）
            if (state.studentId) {
                els.setupModal.classList.add('hidden');
            }
        }
    });

    // Upload
    els.uploadBtn.addEventListener('click', () => {
        console.log('Upload button clicked');
        openCamera();
    });
    els.addMoreBtn.addEventListener('click', () => {
        console.log('Add more button clicked');
        openCamera();
    });

    // Camera Modal Events
    els.cameraShutterBtn.addEventListener('click', takePhoto);
    els.cameraSwitchBtn.addEventListener('click', switchCamera);
    els.cameraCloseBtn.addEventListener('click', stopCamera);

    els.clearAllBtn.addEventListener('click', () => {
        state.images = [];
        els.cameraInput.value = '';
        renderThumbnails();
    });

    els.cameraInput.addEventListener('change', async (e) => {
        const files = e.target.files;
        if (!files || files.length === 0) return;

        try {
            els.uploadBtn.disabled = true;
            const originalText = els.uploadBtn.innerHTML;
            els.uploadBtn.innerHTML = '画像を処理中...';
            
            for (let i = 0; i < files.length; i++) {
                const result = await readFile(files[i]);
                state.images.push(result);
            }
            
            els.uploadBtn.disabled = false;
            els.uploadBtn.innerHTML = originalText;
            els.cameraInput.value = ''; // Reset input
            
            renderThumbnails();
        } catch (error) {
            els.uploadBtn.disabled = false;
            alert('画像の読み込みに失敗しました。');
            console.error(error);
        }
    });

    // Evaluate
    els.evaluateBtn.addEventListener('click', evaluateAnswer);

    // Reset
    els.newQuestionBtn.addEventListener('click', () => {
        state.images = [];
        els.cameraInput.value = '';
        renderThumbnails();
        els.resultSection.classList.add('hidden');
    });
}

function renderThumbnails() {
    els.imagePreviewList.innerHTML = '';
    
    if (state.images.length === 0) {
        els.previewContainer.classList.add('hidden');
        els.evaluateBtn.classList.add('hidden');
        els.uploadBtn.classList.remove('hidden');
        return;
    }

    state.images.forEach((img, index) => {
        const wrapper = document.createElement('div');
        wrapper.className = 'thumbnail-wrapper';

        const imgEl = document.createElement('img');
        imgEl.src = `data:${img.mimeType};base64,${img.data}`;
        
        const removeBtn = document.createElement('button');
        removeBtn.className = 'remove-thumb-btn';
        removeBtn.innerHTML = '×';
        removeBtn.onclick = () => {
            state.images.splice(index, 1);
            renderThumbnails();
        };

        wrapper.appendChild(imgEl);
        wrapper.appendChild(removeBtn);
        els.imagePreviewList.appendChild(wrapper);
    });

    els.uploadBtn.classList.add('hidden');
    els.previewContainer.classList.remove('hidden');
    els.evaluateBtn.classList.remove('hidden');
    els.resultSection.classList.add('hidden');
}

// File Reader & Image Processor
async function readFile(file) {
    const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
    return await processImage(dataUrl);
}

// 汎用画像リサイズ・圧縮処理
function processImage(dataUrl, maxWidth = 1000, quality = 0.7) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            let width = img.width;
            let height = img.height;

            if (width > maxWidth) {
                height = Math.round((height * maxWidth) / width);
                width = maxWidth;
            }

            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);

            const resultDataUrl = canvas.toDataURL('image/jpeg', quality);
            const splitIndex = resultDataUrl.indexOf(',');
            const mimeType = resultDataUrl.substring(5, splitIndex).split(';')[0];
            const base64Data = resultDataUrl.substring(splitIndex + 1);
            
            console.log(`Image processed: ${img.width}x${img.height} -> ${width}x${height}, Quality: ${quality}`);
            resolve({ mimeType, data: base64Data });
        };
        img.onerror = (err) => {
            console.error('Image processing error:', err);
            reject(err);
        };
        img.src = dataUrl;
    });
}

// Camera Functions
async function openCamera() {
    // 端末のネイティブファイル選択ではなく、再度ブラウザ上のカスタムカメラ（getUserMedia）を使用するように戻します
    // Check if getUserMedia is supported
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        console.warn('getUserMedia not supported, falling back to file input');
        els.cameraInput.click();
        return;
    }

    try {
        els.cameraModal.classList.remove('hidden');
        await startStream();
    } catch (err) {
        console.error('Error opening camera:', err);
        // Fallback to native file input if camera fails
        els.cameraModal.classList.add('hidden');
        els.cameraInput.click();
    }
}

async function startStream() {
    // 既にカメラのストリームが有効な場合は、そのまま使い回す（毎回許可が出ないようにする）
    if (cameraState.stream) {
        els.cameraVideo.srcObject = cameraState.stream;
        return;
    }

    const constraints = {
        video: {
            facingMode: cameraState.facingMode,
            width: { ideal: 1920 },
            height: { ideal: 1080 }
        },
        audio: false
    };

    cameraState.stream = await navigator.mediaDevices.getUserMedia(constraints);
    els.cameraVideo.srcObject = cameraState.stream;
}

function stopCamera() {
    // 毎回破棄（stop）すると次に開くときに再度許可が求められるため、ストリームは維持し画面だけ隠す
    els.cameraModal.classList.add('hidden');
}

async function switchCamera() {
    // 切り替え時のみ一度ストリームを破棄して取り直す
    if (cameraState.stream) {
        cameraState.stream.getTracks().forEach(track => track.stop());
        cameraState.stream = null;
    }
    cameraState.facingMode = cameraState.facingMode === 'user' ? 'environment' : 'user';
    try {
        await startStream();
    } catch (err) {
        console.error('Error switching camera:', err);
        alert('カメラの切り替えに失敗しました。');
    }
}

function takePhoto() {
    const video = els.cameraVideo;
    const canvas = els.cameraCanvas;
    
    // リサイズ計算（横幅最大1000px）
    let width = video.videoWidth;
    let height = video.videoHeight;
    const maxWidth = 1000;

    if (width > maxWidth) {
        height = Math.round((height * maxWidth) / width);
        width = maxWidth;
    }

    // キャンバスをリサイズ後のサイズに設定
    canvas.width = width;
    canvas.height = height;
    
    const context = canvas.getContext('2d');
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    
    // JPEG品質0.7で圧縮
    const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
    const splitIndex = dataUrl.indexOf(',');
    const base64Data = dataUrl.substring(splitIndex + 1);
    
    console.log(`Photo taken & resized: ${video.videoWidth}x${video.videoHeight} -> ${width}x${height}`);

    state.images.push({
        mimeType: 'image/jpeg',
        data: base64Data
    });
    
    renderThumbnails();
    stopCamera();
}

// Main Logic
async function evaluateAnswer() {
    if (state.images.length === 0) return;
    if (!state.studentId) {
        alert('生徒番号の登録が必要です。');
        els.setupModal.classList.remove('hidden');
        return;
    }

    const problemId = els.problemSelect.value;
    if (!problemId) {
        alert('回と問題を選択してください。');
        return;
    }

    els.evaluateBtn.disabled = true;
    els.evaluateBtn.classList.add('hidden');
    els.loadingIndicator.classList.remove('hidden');
    els.resultSection.classList.add('hidden');

    // 0秒〜5秒（5000ミリ秒）の間でランダムな待ち時間を生成して通信を分散させる（アクセス集中対策）
    const randomDelay = Math.floor(Math.random() * 5000);
    console.log(`Waiting for random delay: ${randomDelay}ms`);
    await new Promise(resolve => setTimeout(resolve, randomDelay));

    try {
        const prompt = `
提供された画像を生徒の解答として添削してください。
合格・再チャレンジの判定基準として、解答した問題数の8割以上が正解であれば「レベルアップして次の問題へ！」、それに満たない場合は「同じレベルの次の問題へ！」としてください。
【重要】生徒が途中式から書き始めている場合があるため、最初の式が問題文と完全に一致していなくても「問題と不一致である」という指摘はしないでください。計算の途中として正しければ正解として扱ってください。
処理を軽くするため、挨拶や無関係な話題は一切省略してください。

以下のフォーマットに沿って出力してください。

[判定]
（「レベルアップして次の問題へ！」または「同じレベルの次の問題へ！」のどちらかのみ）

[詳細]
結果: （例: 5問中4問正解など）

読み取った解答と正誤:
（各問題に対して、以下の形式で正誤を明記してください。**途中式や解説は一切含めず、答えのみ**を記載してください）
形式例：
(1) 正解： [答え]
(2) 不正解： [答え]

フィードバック:
（不正解の問題がある場合のみ、問題番号を明記して、間違えた原因と途中式を含む正解例を記載してください。全問正解の場合は簡潔なお祝いの言葉のみで結構です。数式には必ずKaTeX形式を用いてください）
`;

        const payload = {
            apiKey: "server", // サーバー側キーを使用するフラグ
            isStudentApp: true,
            subject: "other",
            problemId: problemId,
            userPrompt: prompt,
            images: {
                student: state.images
            }
        };

        const response = await fetch(GAS_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' }, // Avoid CORS preflight on GAS sometimes
            body: JSON.stringify(payload)
        });

        const data = await response.json();

        if (data.error) {
            throw new Error(data.error);
        }

        const aiResponse = data.candidates[0].content.parts[0].text;
        
        // パース
        displayResult(aiResponse);

        // GASへ保存
        sendLogToGAS(aiResponse);

    } catch (err) {
        console.error(err);
        alert('エラーが発生しました: ' + err.message);
        els.evaluateBtn.classList.remove('hidden');
    } finally {
        els.loadingIndicator.classList.add('hidden');
        els.evaluateBtn.disabled = false;
    }
}

function displayResult(text) {
    let badgeText = "判定不能";
    let detailText = text;
    let badgeClass = "";

    // [判定] と [詳細] で分割を試みる
    const badgeMatch = text.match(/\\[判定\\]\\s*([^\\n]+)/);
    if (badgeMatch) {
        badgeText = badgeMatch[1].trim();
        const detailSplit = text.split(/\\[詳細\\]/);
        if (detailSplit.length > 1) {
            detailText = detailSplit[1].trim();
        }
    } else {
        // フォールバック: テキスト内に合格が含まれるか
        if (text.includes('レベルアップ')) badgeText = 'レベルアップして次の問題へ！';
        else if (text.includes('同じレベル')) badgeText = '同じレベルの次の問題へ！';
    }

    if (badgeText.includes('レベルアップ')) {
        els.resultBadge.className = 'result-badge pass';
        els.resultBadge.textContent = '🎉 レベルアップして次の問題へ！';
    } else {
        els.resultBadge.className = 'result-badge retry';
        els.resultBadge.textContent = '💪 同じレベルの次の問題へ！';
    }

    // Markdown パース (KaTeXの\\などが消えないようにバックスラッシュをエスケープ)
    const processedText = detailText.replace(/\\/g, '\\\\');
    els.resultContent.innerHTML = marked.parse(processedText, { breaks: true });

    // KaTeX(数式)レンダリング
    if (typeof renderMathInElement === 'function') {
        try {
            renderMathInElement(els.resultContent, {
                delimiters: [
                    {left: "$$", right: "$$", display: true},
                    {left: "\\[", right: "\\]", display: true},
                    {left: "$", right: "$", display: false},
                    {left: "\\(", right: "\\)", display: false}
                ],
                throwOnError: false
            });
        } catch (e) {
            console.error("KaTeX rendering error:", e);
        }
    }

    els.resultSection.classList.remove('hidden');
}

async function sendLogToGAS(resultText) {
    try {
        const payload = {
            action: "saveResult",
            studentId: state.studentId,
            problemId: els.problemSelect.value || "",
            resultText: resultText
        };
        
        // スプレッドシート側のGASの提出履歴に保存
        fetch(GAS_API_URL, {
            method: 'POST',
            mode: 'no-cors',
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify(payload)
        });
    } catch (e) {
        console.error('Failed to save result to GAS', e);
    }
}

// 起動
init();
