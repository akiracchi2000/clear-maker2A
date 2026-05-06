// Configuration
const GAS_API_URL = 'https://script.google.com/macros/s/AKfycbwT8ED1qE-4gqRGM-y4xup-K9lSt3S7CanT9n24OIpT5sI7m4kkb09mOG5PHX4bjlPi/exec';

// State
let state = {
    studentId: '',
    images: [],
};
let problemData = {};

const BRANCHING_FLOW_SUFFIX = {
    '011': { pass: '022', retry: '021' },
    '021': { pass: '032', retry: '031' },
    '022': { pass: '033', retry: '032' },
    '031': { pass: '042', retry: '041' },
    '032': { pass: '043', retry: '042' },
    '033': { pass: '043', retry: '042' },
    '041': { pass: '022', retry: '022' },
    '042': { pass: '033', retry: '033' },
    '043': { pass: '', retry: '' },
};

// DOM Elements
const els = {
    setupModal: document.getElementById('setup-modal'),
    studentIdInput: document.getElementById('student-id'),
    problemPicker: document.getElementById('problem-picker'),
    roundSelect: document.getElementById('round-select'),
    problemSelect: document.getElementById('problem-select'),
    problemDisplay: document.getElementById('problem-display'),
    problemDisplayLabel: document.getElementById('problem-display-label'),
    problemDisplayImage: document.getElementById('problem-display-image'),
    problemDisplayMessage: document.getElementById('problem-display-message'),
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
    todaySummaryBtn: document.getElementById('today-summary-btn'),
    todaySummarySection: document.getElementById('today-summary-section'),
    todaySummaryCauses: document.getElementById('today-summary-causes'),
    todaySummaryStatus: document.getElementById('today-summary-status'),
    todaySummaryList: document.getElementById('today-summary-list'),
    newQuestionBtn: document.getElementById('new-question-btn'),

    cameraModal: document.getElementById('camera-modal'),
    cameraVideo: document.getElementById('camera-video'),
    cameraCanvas: document.getElementById('camera-canvas'),
    cameraShutterBtn: document.getElementById('camera-shutter-btn'),
    cameraSwitchBtn: document.getElementById('camera-switch-btn'),
    cameraCloseBtn: document.getElementById('camera-close-btn'),
};

let cameraState = {
    stream: null,
    facingMode: 'environment',
};

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
        const response = await fetch(GAS_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify({ action: 'getProblems' }),
        });
        const json = await response.json();

        if (json.status !== 'success' || !json.data) {
            throw new Error(json.error || 'データ取得に失敗しました');
        }

        problemData = json.data;
        els.roundSelect.innerHTML = '<option value="">-- 回を選択 --</option>';
        Object.keys(problemData).forEach(round => {
            const opt = document.createElement('option');
            opt.value = round;
            opt.textContent = round;
            els.roundSelect.appendChild(opt);
        });
        els.roundSelect.disabled = false;
    } catch (e) {
        console.error(e);
        els.roundSelect.innerHTML = '<option value="">-- 読込失敗 --</option>';
    }
}

function updateUserInfo() {
    if (!state.studentId) return;
    els.displayStudentId.textContent = state.studentId;
    els.userInfo.classList.remove('hidden');
}

function getRoundKeys() {
    return Object.keys(problemData);
}

function getSelectedProblem() {
    const round = els.roundSelect.value;
    const problemId = els.problemSelect.value;
    if (!round || !problemId || !problemData[round]) return null;
    return problemData[round].find(problem => problem.id === problemId) || null;
}

async function renderSelectedProblem() {
    const problem = getSelectedProblem();
    if (!problem) {
        clearProblemDisplay();
        return;
    }

    els.problemDisplayLabel.textContent = `${problem.label} (${problem.id})`;
    els.problemDisplay.classList.remove('hidden');
    els.problemDisplayImage.removeAttribute('src');
    els.problemDisplayImage.alt = `${problem.label} の問題画像`;
    els.problemDisplayMessage.textContent = '問題画像を読み込んでいます...';

    try {
        const imageData = await fetchProblemImage(problem.id);
        if (els.problemSelect.value !== problem.id) return;

        if (imageData) {
            els.problemDisplayImage.src = imageData;
            els.problemDisplayMessage.textContent = '';
        } else if (problem.imageUrl) {
            els.problemDisplayImage.src = problem.imageUrl;
            els.problemDisplayMessage.textContent = '';
        } else {
            els.problemDisplayImage.alt = '問題画像が見つかりません';
            els.problemDisplayMessage.textContent = '問題画像が見つかりません。';
        }
    } catch (e) {
        console.error(e);
        if (problem.imageUrl) {
            els.problemDisplayImage.src = problem.imageUrl;
            els.problemDisplayMessage.textContent = '';
        } else {
            els.problemDisplayImage.alt = '問題画像を読み込めませんでした';
            els.problemDisplayMessage.textContent = `問題画像を読み込めませんでした。${e.message ? ` (${e.message})` : ''}`;
        }
    }
}

async function fetchProblemImage(problemId) {
    const response = await fetch(GAS_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({
            action: 'getProblemImage',
            problemId,
        }),
    });
    if (!response.ok) {
        throw new Error(`画像APIエラー: HTTP ${response.status}`);
    }
    const json = await response.json();
    if (json.error) throw new Error(json.error);
    return json.status === 'success' ? json.imageData : '';
}

function clearProblemDisplay() {
    els.problemDisplay.classList.add('hidden');
    els.problemDisplayLabel.textContent = '';
    els.problemDisplayImage.removeAttribute('src');
    els.problemDisplayImage.alt = '問題画像';
    els.problemDisplayMessage.textContent = '';
}

function setProblemPickerVisible(isVisible) {
    if (!els.problemPicker) return;
    els.problemPicker.classList.toggle('hidden', !isVisible);
}

function setupEventListeners() {
    els.roundSelect.addEventListener('change', (e) => {
        const round = e.target.value;
        clearProblemDisplay();
        populateProblemSelect(round);
        if (round) {
            selectStartProblemForRound(round);
        } else {
            setProblemPickerVisible(true);
        }
    });

    els.problemSelect.addEventListener('change', () => {
        renderSelectedProblem();
    });

    els.saveSetupBtn.addEventListener('click', () => {
        const id = els.studentIdInput.value.trim();
        if (!id) {
            alert('生徒番号を入力してください。');
            return;
        }

        state.studentId = id;
        localStorage.setItem('student_id', id);
        updateUserInfo();
        els.setupModal.classList.add('hidden');
    });

    els.settingsBtn.addEventListener('click', () => {
        els.studentIdInput.value = state.studentId;
        els.setupModal.classList.remove('hidden');
    });

    els.setupModal.addEventListener('click', (e) => {
        if (e.target === els.setupModal && state.studentId) {
            els.setupModal.classList.add('hidden');
        }
    });

    els.uploadBtn.addEventListener('click', openCamera);
    els.addMoreBtn.addEventListener('click', openCamera);
    els.cameraShutterBtn.addEventListener('click', takePhoto);
    els.cameraSwitchBtn.addEventListener('click', switchCamera);
    els.cameraCloseBtn.addEventListener('click', stopCamera);
    els.evaluateBtn.addEventListener('click', evaluateAnswer);
    els.todaySummaryBtn.addEventListener('click', showTodaySummary);

    els.clearAllBtn.addEventListener('click', () => {
        state.images = [];
        els.cameraInput.value = '';
        renderThumbnails();
    });

    els.cameraInput.addEventListener('change', async (e) => {
        const files = e.target.files;
        if (!files || files.length === 0) return;

        const originalText = els.uploadBtn.innerHTML;
        try {
            els.uploadBtn.disabled = true;
            els.uploadBtn.innerHTML = '画像を処理中...';

            for (let i = 0; i < files.length; i++) {
                const result = await readFile(files[i]);
                state.images.push(result);
            }

            els.cameraInput.value = '';
            renderThumbnails();
        } catch (error) {
            alert('画像の読み込みに失敗しました。');
            console.error(error);
        } finally {
            els.uploadBtn.disabled = false;
            els.uploadBtn.innerHTML = originalText;
        }
    });

    els.newQuestionBtn.addEventListener('click', () => {
        state.images = [];
        els.cameraInput.value = '';
        renderThumbnails();
        els.resultSection.classList.add('hidden');
        clearTodaySummary();
        setProblemPickerVisible(true);
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
        removeBtn.type = 'button';
        removeBtn.textContent = '×';
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

async function readFile(file) {
    const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
    return processImage(dataUrl);
}

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

            resolve({ mimeType, data: base64Data });
        };
        img.onerror = reject;
        img.src = dataUrl;
    });
}

async function openCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        els.cameraInput.click();
        return;
    }

    try {
        els.cameraModal.classList.remove('hidden');
        await startStream();
    } catch (err) {
        console.error('Error opening camera:', err);
        els.cameraModal.classList.add('hidden');
        els.cameraInput.click();
    }
}

async function startStream() {
    if (cameraState.stream) {
        els.cameraVideo.srcObject = cameraState.stream;
        return;
    }

    const constraints = {
        video: {
            facingMode: cameraState.facingMode,
            width: { ideal: 1920 },
            height: { ideal: 1080 },
        },
        audio: false,
    };

    cameraState.stream = await navigator.mediaDevices.getUserMedia(constraints);
    els.cameraVideo.srcObject = cameraState.stream;
}

function stopCamera() {
    els.cameraModal.classList.add('hidden');
}

async function switchCamera() {
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
    let width = video.videoWidth;
    let height = video.videoHeight;
    const maxWidth = 1000;

    if (width > maxWidth) {
        height = Math.round((height * maxWidth) / width);
        width = maxWidth;
    }

    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d').drawImage(video, 0, 0, width, height);

    const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
    const splitIndex = dataUrl.indexOf(',');
    const base64Data = dataUrl.substring(splitIndex + 1);

    state.images.push({
        mimeType: 'image/jpeg',
        data: base64Data,
    });

    renderThumbnails();
    stopCamera();
}

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

    const randomDelay = Math.floor(Math.random() * 5000);
    await new Promise(resolve => setTimeout(resolve, randomDelay));

    try {
        const prompt = `
【重要】
最初に、指定された問題番号と画像内の問題が一致しているか確認してください。
もし全く異なる問題の解答であると判断した場合は、添削やフォーマット出力は行わず、次の文字列のみを出力してください。
指定した問題が間違っています

問題が一致している場合は、生徒の解答を添削してください。
合格判定は、解答した問題数の8割以上が正解なら「レベルアップして次の問題へ！」、それ以外なら「同じレベルの次の問題へ！」としてください。
生徒が途中式から書き始めている場合も、計算過程として正しければ正解として扱ってください。
雑談や無関係な話題は省略してください。

以下のフォーマットで出力してください。
[判定]
「レベルアップして次の問題へ！」または「同じレベルの次の問題へ！」のどちらかのみ

[詳細]
結果: 例 5問中4問正解
読み取った解答と正誤:
各問題について、途中式や解説は省き、答えと正誤のみを書いてください。
形式例:
(1) 正解: [答え]
(2) 不正解: [答え]

フィードバック:
不正解の問題がある場合のみ、問題番号、間違えた原因、正しい考え方を簡潔に書いてください。
原因には、可能なら「たすき掛け」「因数分解」「平方完成」「判別式」「場合分け」など、復習すべきテーマ名を必ず含めてください。
全問正解の場合は、短いお祝いの言葉のみで構いません。
数式はKaTeX形式で書いてください。`;

        const payload = {
            apiKey: 'server',
            isStudentApp: true,
            subject: 'other',
            problemId,
            userPrompt: prompt,
            images: {
                student: state.images,
            },
        };

        const response = await fetch(GAS_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify(payload),
        });
        const data = await response.json();
        els.loadingIndicator.classList.add('hidden');

        if (data.error) {
            throw new Error(data.error);
        }

        const aiResponse = data.candidates[0].content.parts[0].text;
        const badgeText = displayResult(aiResponse);
        await sendLogToGAS(aiResponse, problemId);
        if (badgeText) selectNextProblemByResult(badgeText);
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
    if (text.includes('指定した問題が間違っています')) {
        els.resultBadge.className = 'result-badge retry';
        els.resultBadge.textContent = '指定した問題が間違っています';
        els.resultContent.innerHTML = '<p>アップロードした画像と選択した問題が一致していないようです。問題番号と画像を確認して、もう一度やり直してください。</p>';
        els.resultSection.classList.remove('hidden');
        els.evaluateBtn.classList.remove('hidden');
        return '';
    }

    let badgeText = '判定不明';
    let detailText = text;

    const badgeMatch = text.match(/\[判定\]\s*([^\n]+)/);
    if (badgeMatch) {
        badgeText = badgeMatch[1].trim();
        const detailSplit = text.split(/\[詳細\]/);
        if (detailSplit.length > 1) {
            detailText = detailSplit[1].trim();
        }
    } else if (text.includes('レベルアップ')) {
        badgeText = 'レベルアップして次の問題へ！';
    } else if (text.includes('同じレベル')) {
        badgeText = '同じレベルの次の問題へ！';
    }

    if (badgeText.includes('レベルアップ')) {
        els.resultBadge.className = 'result-badge pass';
        els.resultBadge.textContent = 'レベルアップして次の問題へ！';
    } else {
        els.resultBadge.className = 'result-badge retry';
        els.resultBadge.textContent = '同じレベルの次の問題へ！';
    }

    const processedText = detailText.replace(/\\/g, '\\\\');
    els.resultContent.innerHTML = marked.parse(processedText, { breaks: true });
    renderMath(els.resultContent);

    els.resultSection.classList.remove('hidden');
    clearTodaySummary();
    return badgeText;
}

function selectNextProblemByResult(badgeText) {
    els.loadingIndicator.classList.add('hidden');
    const currentRound = els.roundSelect.value;
    const currentProblemId = els.problemSelect.value;
    if (!currentRound || !currentProblemId || !problemData[currentRound]) return;

    const flowNextProblemId = getFlowNextProblemId(currentRound, currentProblemId, badgeText);
    if (flowNextProblemId) {
        selectProblem(currentRound, flowNextProblemId);
        return;
    }
    if (flowNextProblemId === '') {
        showRoundComplete();
        return;
    }

    const roundKeys = getRoundKeys();
    const currentRoundIndex = roundKeys.indexOf(currentRound);
    const currentProblems = problemData[currentRound];
    const currentProblemIndex = currentProblems.findIndex(problem => problem.id === currentProblemId);

    if (badgeText.includes('レベルアップ')) {
        const nextRound = roundKeys[currentRoundIndex + 1];
        if (nextRound && problemData[nextRound] && problemData[nextRound].length > 0) {
            selectProblem(nextRound, problemData[nextRound][0].id);
        }
        return;
    }

    const nextProblem = currentProblems[currentProblemIndex + 1];
    if (nextProblem) {
        selectProblem(currentRound, nextProblem.id);
    }
}

function selectStartProblemForRound(round) {
    if (!round || !problemData[round] || problemData[round].length === 0) return;

    const startProblem = getProblemBySuffix(round, '011') || problemData[round][0];
    selectProblem(round, startProblem.id);
}

function getFlowNextProblemId(round, problemId, badgeText) {
    const suffix = String(problemId || '').slice(-3);
    if (!BRANCHING_FLOW_SUFFIX[suffix]) return null;

    const route = badgeText.includes('レベルアップ') ? 'pass' : 'retry';
    const nextSuffix = BRANCHING_FLOW_SUFFIX[suffix][route];
    if (!nextSuffix) return '';

    const nextProblem = getProblemBySuffix(round, nextSuffix);
    return nextProblem ? nextProblem.id : '';
}

function getProblemBySuffix(round, suffix) {
    if (!round || !problemData[round]) return null;
    return problemData[round].find(problem => String(problem.id || '').endsWith(suffix)) || null;
}

function showRoundComplete() {
    clearProblemDisplay();
    resetImagesForNextProblem();
    setProblemPickerVisible(false);
    els.problemDisplayLabel.textContent = 'この回は完了です';
    els.problemDisplayMessage.textContent = '本日のまとめで解き直し問題を確認できます。';
    els.problemDisplay.classList.remove('hidden');
}

function selectProblem(round, problemId) {
    if (!round || !problemId || !problemData[round]) return;

    els.loadingIndicator.classList.add('hidden');
    resetImagesForNextProblem();
    els.roundSelect.value = round;
    populateProblemSelect(round);
    els.problemSelect.value = problemId;
    setProblemPickerVisible(false);
    renderSelectedProblem();
}

function populateProblemSelect(round) {
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
}

function resetImagesForNextProblem() {
    state.images = [];
    els.cameraInput.value = '';
    els.imagePreviewList.innerHTML = '';
    els.previewContainer.classList.add('hidden');
    els.evaluateBtn.classList.add('hidden');
    els.uploadBtn.classList.remove('hidden');
}

async function sendLogToGAS(resultText, problemId) {
    try {
        const payload = {
            action: 'saveResult',
            studentId: state.studentId,
            problemId: problemId || els.problemSelect.value || '',
            resultText,
        };

        return fetch(GAS_API_URL, {
            method: 'POST',
            mode: 'no-cors',
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify(payload),
        });
    } catch (e) {
        console.error('Failed to save result to GAS', e);
    }
}

async function showTodaySummary() {
    if (!state.studentId) {
        alert('生徒番号を登録してください。');
        els.setupModal.classList.remove('hidden');
        return;
    }

    els.todaySummaryBtn.disabled = true;
    els.todaySummarySection.classList.remove('hidden');
    els.todaySummaryStatus.textContent = '今日の結果を確認しています...';
    els.todaySummaryList.innerHTML = '';

    try {
        const response = await fetch(GAS_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify({
                action: 'getTodayReview',
                studentId: state.studentId,
            }),
        });
        const json = await response.json();

        if (json.error) {
            throw new Error(json.error);
        }

        renderTodaySummary(json);
    } catch (e) {
        console.error(e);
        els.todaySummaryStatus.textContent = '今日のまとめを取得できませんでした。少し時間を置いてもう一度試してください。';
    } finally {
        els.todaySummaryBtn.disabled = false;
    }
}

function renderTodaySummary(data) {
    const retryIds = data.retryProblemIds || [];
    const answeredIds = data.answeredProblemIds || [];
    const retryCauses = data.retryCauses || [];
    const items = data.reviewItems || [];

    if (answeredIds.length === 0) {
        els.todaySummaryStatus.textContent = `${data.date || '今日'}に記録された添削結果はまだありません。`;
        els.todaySummaryCauses.innerHTML = '';
        els.todaySummaryList.innerHTML = '';
        return;
    }

    if (retryIds.length === 0) {
        els.todaySummaryStatus.textContent = '今日の添削結果に誤答は見つかりませんでした。解き直し候補はありません。';
        els.todaySummaryCauses.innerHTML = '';
        els.todaySummaryList.innerHTML = '';
        return;
    }

    els.todaySummaryStatus.textContent = '';
    els.todaySummaryCauses.innerHTML = '';
    els.todaySummaryList.innerHTML = '';
    renderRetryCauses(retryCauses);

    if (items.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'today-summary-empty';
        empty.textContent = '該当する問題文が見つかりませんでした。';
        els.todaySummaryList.appendChild(empty);
        return;
    }

    items.forEach(item => {
        const card = document.createElement('article');
        card.className = 'today-summary-card';

        const numbers = document.createElement('div');
        numbers.className = 'today-summary-numbers';
        const chip = document.createElement('span');
        const finalLabel = getReviewDisplayLabel(item);
        chip.textContent = finalLabel;
        numbers.appendChild(chip);

        const question = document.createElement('div');
        question.className = 'today-summary-question markdown-body';
        question.textContent = item.question || '';

        card.appendChild(numbers);
        if (item.themes && item.themes.length > 0) {
            const themes = document.createElement('div');
            themes.className = 'today-summary-themes';
            themes.textContent = `テーマ: ${item.themes.join(' / ')}`;
            card.appendChild(themes);
        }
        card.appendChild(question);
        els.todaySummaryList.appendChild(card);
    });

    renderMath(els.todaySummaryList);
    normalizeRenderedReviewLabels();
    setTimeout(normalizeRenderedReviewLabels, 0);
    setTimeout(normalizeRenderedReviewLabels, 200);
}

function renderRetryCauses(retryCauses) {
    if (!retryCauses || retryCauses.length === 0) return;

    const causeBox = document.createElement('section');
    causeBox.className = 'today-summary-causes';

    const title = document.createElement('h4');
    title.textContent = '今回のつまづき';
    causeBox.appendChild(title);

    retryCauses.forEach(item => {
        const row = document.createElement('div');
        row.className = 'today-summary-cause';

        const cause = document.createElement('span');
        cause.textContent = shortenSummaryText(item.cause || '誤答理由を確認', 20);

        row.appendChild(cause);
        causeBox.appendChild(row);
    });

    els.todaySummaryCauses.appendChild(causeBox);
}

function formatReviewProblemNumber(value) {
    const text = normalizeProblemNumberText(value);
    if (!text) return '-';

    const match = text.match(/^(\d)(\d)(\d)(.*)$/);
    if (!match) return text;

    const chapter = Number(match[1]);
    const exercise = Number(match[2]);
    const problem = Number(match[3]);
    const suffix = match[4] || '';
    return `第${chapter}章演習問題${exercise}-${problem}${suffix}`;
}

function getReviewDisplayLabel(item) {
    const directLabel = getDirectReviewDisplayLabel(item);
    if (directLabel) return directLabel;

    const labelFromColumns = formatReviewProblemLabel([item.numberA, item.numberB, item.numberC, item.numberD]);
    if (labelFromColumns && labelFromColumns !== '-') {
        return labelFromColumns;
    }

    const candidates = [
        item.displayLabel,
        item.displayNumber,
    ];
    for (const candidate of candidates) {
        const label = fixExercise13Label(normalizeReviewDisplayLabel(candidate));
        if (label && label !== '-') return label;
    }
    return '-';
}

function getDirectReviewDisplayLabel(item) {
    const chapter = normalizeProblemNumberText(item.numberA);
    const b = normalizeProblemNumberText(item.numberB);
    const c = normalizeProblemNumberText(item.numberC);
    const d = normalizeProblemNumberText(item.numberD);
    if (/^\d+$/.test(chapter) && /^\d{2,}$/.test(b) && !c && d) {
        return `第${Number(chapter)}章演習問題${Number(b)}-${formatSubProblemMarker(d)}`;
    }
    return '';
}

function normalizeReviewDisplayLabel(label) {
    const text = String(label || '')
        .trim()
        .replace(/[０-９]/g, char => String.fromCharCode(char.charCodeAt(0) - 0xFEE0))
        .replace(/[（]/g, '(')
        .replace(/[）]/g, ')')
        .replace(/[‐‑‒–—―－−ー]/g, '-')
        .replace(/[\u200B-\u200D\uFEFF]/g, '')
        .replace(/\s+/g, '');
    return text.replace(/第(\d+)章演習問題([1-3])[-ｰ]([0-9])\(([^)]+)\)/g, (_all, chapter, tens, ones, suffix) => {
        return `第${Number(chapter)}章演習問題${Number(tens + ones)}-(${suffix})`;
    });
}

function normalizeRenderedReviewLabels() {
    els.todaySummaryList.querySelectorAll('.today-summary-numbers span').forEach(chip => {
        const normalized = fixExercise13Label(normalizeReviewDisplayLabel(chip.textContent));
        if (chip.textContent !== normalized) chip.textContent = normalized;
    });
}

function fixExercise13Label(label) {
    const text = String(label || '');
    const marker = '演習問題';
    const index = text.indexOf(marker);
    if (index === -1) return text;

    const prefix = text.slice(0, index + marker.length);
    const rest = text.slice(index + marker.length);
    const match = rest.match(/^\s*1[\s\S]{0,8}?3\s*[（(]/);
    if (!match) return text;

    return prefix + '13-(' + rest.slice(match[0].length);
}

function shortenSummaryText(value, maxLength) {
    const text = String(value || '').trim();
    if (!text) return '';
    return text.length > maxLength ? `${text.substring(0, maxLength)}...` : text;
}

function formatReviewProblemLabel(numbers) {
    const values = [0, 1, 2, 3].map(index => normalizeProblemNumberText((numbers || [])[index]));
    const [chapter, b, c, d] = values;

    if (/^\d+$/.test(chapter)) {
        if (/^\d{2,}$/.test(b) && !c && d) {
            return `第${Number(chapter)}章演習問題${Number(b)}-${formatSubProblemMarker(d)}`;
        }
        if (/^\d{2,}$/.test(b) && isSubProblemMarker(c)) {
            return `第${Number(chapter)}章演習問題${Number(b)}-${formatSubProblemMarker(c)}${d || ''}`;
        }
        if (/^[1-3]$/.test(b) && /^\d$/.test(c) && isSubProblemMarker(d)) {
            return `第${Number(chapter)}章演習問題${Number(b + c)}-${formatSubProblemMarker(d)}`;
        }
        if (/^\d+$/.test(b) && /^\d+$/.test(c)) {
            return `第${Number(chapter)}章演習問題${Number(b)}-${Number(c)}${d || ''}`;
        }
    }

    return formatReviewProblemNumber(values.filter(Boolean).join(''));
}

function normalizeProblemNumberText(value) {
    return String(value || '')
        .trim()
        .replace(/[０-９]/g, char => String.fromCharCode(char.charCodeAt(0) - 0xFEE0))
        .replace(/[（]/g, '(')
        .replace(/[）]/g, ')')
        .replace(/\.0$/, '')
        .replace(/\s+/g, '');
}

function isSubProblemMarker(value) {
    const text = String(value || '').trim();
    return /^\(.+\)$/.test(text) || /^\d+$/.test(text);
}

function formatSubProblemMarker(value) {
    const text = String(value || '').trim();
    return /^\d+$/.test(text) ? `(${Number(text)})` : text;
}

function renderMath(element) {
    if (typeof renderMathInElement !== 'function') {
        setTimeout(() => renderMath(element), 100);
        return;
    }

    try {
        renderMathInElement(element, {
            delimiters: [
                { left: '$$', right: '$$', display: true },
                { left: '\\[', right: '\\]', display: true },
                { left: '$', right: '$', display: false },
                { left: '\\(', right: '\\)', display: false },
            ],
            throwOnError: false,
        });
    } catch (e) {
        console.error('KaTeX rendering error:', e);
    }
}

function clearTodaySummary() {
    els.todaySummarySection.classList.add('hidden');
    els.todaySummaryCauses.innerHTML = '';
    els.todaySummaryStatus.textContent = '';
    els.todaySummaryList.innerHTML = '';
}

init();
