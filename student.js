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

// File Reader
function readFile(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const dataUrl = e.target.result;
            const splitIndex = dataUrl.indexOf(',');
            const mimeType = dataUrl.substring(5, splitIndex).split(';')[0];
            const base64Data = dataUrl.substring(splitIndex + 1);
            resolve({ mimeType: mimeType, data: base64Data });
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

// Camera Functions
async function openCamera() {
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
    if (cameraState.stream) {
        cameraState.stream.getTracks().forEach(track => track.stop());
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
    if (cameraState.stream) {
        cameraState.stream.getTracks().forEach(track => track.stop());
        cameraState.stream = null;
    }
    els.cameraVideo.srcObject = null;
    els.cameraModal.classList.add('hidden');
}

async function switchCamera() {
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
    
    // Set canvas dimensions to match video stream
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    
    const context = canvas.getContext('2d');
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    
    const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
    const splitIndex = dataUrl.indexOf(',');
    const base64Data = dataUrl.substring(splitIndex + 1);
    
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

    try {
        const prompt = `
提供された画像を生徒の解答として添削してください。
処理を極力軽く（速く）するため、挨拶や詳しい解説などは一切省略してください。

以下のフォーマットに沿って3行だけで出力してください。

[判定]
（「合格！」または「再チャレンジ！」のどちらかのみ）

[詳細]
正誤: （正解 か 不正解）
一言: （誤答の理由やアドバイスなどを20文字程度で簡潔に）
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
        els.evaluateBtn.disabled = false;
        els.evaluateBtn.classList.remove('hidden');
    } finally {
        els.loadingIndicator.classList.add('hidden');
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
        if (text.includes('合格')) badgeText = '合格！';
        else if (text.includes('再チャレンジ')) badgeText = '再チャレンジ！';
    }

    if (badgeText.includes('合格')) {
        els.resultBadge.className = 'result-badge pass';
        els.resultBadge.textContent = '🎉 合格！';
    } else {
        els.resultBadge.className = 'result-badge retry';
        els.resultBadge.textContent = '💪 再チャレンジ！';
    }

    // Markdown パース
    els.resultContent.innerHTML = marked.parse(detailText);

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
