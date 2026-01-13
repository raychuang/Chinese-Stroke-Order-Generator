const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// 配置参数
const CONFIG = {
    character: '中', // 要生成的汉字
    width: 500,
    height: 500,
    fps: 15, // 帧率
    outputDir: './output',
    tempDir: './temp'
};

// 确保输出目录存在
if (!fs.existsSync(CONFIG.outputDir)) {
    fs.mkdirSync(CONFIG.outputDir, { recursive: true });
}
if (!fs.existsSync(CONFIG.tempDir)) {
    fs.mkdirSync(CONFIG.tempDir, { recursive: true });
}

// 检查FFmpeg是否可用
function checkFFmpeg() {
    try {
        execSync('ffmpeg -version', { stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
}

// 查找Chrome路径
function findChromePath() {
    const platform = process.platform;
    let possiblePaths = [];

    if (platform === 'darwin') {
        possiblePaths = [
            '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
            '/Applications/Chromium.app/Contents/MacOS/Chromium',
            '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
        ];
    } else if (platform === 'win32') {
        const suffix = '\\Google\\Chrome\\Application\\chrome.exe';
        const prefixes = [
            process.env.LOCALAPPDATA,
            process.env.PROGRAMFILES,
            process.env['PROGRAMFILES(X86)']
        ].filter(Boolean);

        possiblePaths = prefixes.map(prefix => prefix + suffix);
    } else {
        // Linux
        possiblePaths = [
            '/usr/bin/google-chrome',
            '/usr/bin/chromium-browser',
            '/usr/bin/chromium',
            '/usr/bin/google-chrome-stable'
        ];
    }

    for (const p of possiblePaths) {
        if (fs.existsSync(p)) {
            return p;
        }
    }

    return null;
}

async function generateGIF(character) {
    console.log(`开始生成汉字 "${character}" 的笔顺动画GIF...`);
    
    const executablePath = findChromePath();
    if (!executablePath) {
        throw new Error('未找到Chrome/Chromium浏览器，请确保已安装Google Chrome');
    }
    console.log(`使用浏览器: ${executablePath}`);

    if (!checkFFmpeg()) {
        throw new Error('FFmpeg未安装或配置错误，请安装FFmpeg并配置到系统PATH中');
    }

    const browser = await puppeteer.launch({
        executablePath,
        headless: true,
        userDataDir: path.join(CONFIG.tempDir, 'chrome-user-data'),
        args: [
            '--no-sandbox', 
            '--disable-setuid-sandbox',
            '--allow-file-access-from-files' // 允许从文件加载资源
        ]
    });
    
    const tempFrameDir = path.join(CONFIG.tempDir, character);
    if (!fs.existsSync(tempFrameDir)) {
        fs.mkdirSync(tempFrameDir, { recursive: true });
    }
    
    try {
        const page = await browser.newPage();
        
        // 设置视口大小（增加边距以包含水印）
        await page.setViewport({
            width: CONFIG.width + 40,
            height: CONFIG.height + 40
        });
        
        // 加载HTML页面
        const htmlPath = path.join(__dirname, 'index.html');
        await page.goto(`file://${htmlPath}?char=${encodeURIComponent(character)}`);
        
        // 等待Hanzi Writer加载
        await page.waitForFunction(() => window.writer !== undefined, { timeout: 10000 });
        
        // 等待动画准备就绪（增加超时时间，并添加更宽松的检查）
        try {
            await page.waitForFunction(() => window.animationReady === true, { timeout: 15000 });
        } catch {
            console.warn('等待animationReady超时，继续执行...');
            // 即使超时也继续，给一些额外时间
            await page.waitForTimeout(1000);
        }
        
        console.log('开始录制动画帧...');
        
        // 额外等待确保渲染完成
        await page.waitForTimeout(500);
        
        // 录制帧
        const frameInterval = 1000 / CONFIG.fps; // 每帧间隔（毫秒）
        // const totalDuration = 10000; // 不再使用固定总时长
        // const totalFrames = Math.ceil(totalDuration / frameInterval);
        
        console.log('开始录制循环...');
        
        let frameCount = 0;
        let finishedFrameCount = 0; // 动画结束后继续录制的帧数
        const extraFramesAfterFinish = CONFIG.fps * 2; // 动画结束后多录2秒
        const maxFrames = CONFIG.fps * 60; // 最大录制60秒，防止死循环
        const startAnimationAtFrame = 5; // 在第5帧启动动画（约0.3秒后），确保录到开头
        
        while (true) {
            const framePath = path.join(tempFrameDir, `frame${String(frameCount).padStart(4, '0')}.png`);
            
            // 截图
            await page.screenshot({
                path: framePath,
                clip: {
                    x: 0,
                    y: 0,
                    width: CONFIG.width + 40,
                    height: CONFIG.height + 40
                }
            });
            
            // 在指定帧启动动画
            if (frameCount === startAnimationAtFrame) {
                console.log('启动动画...');
                await page.evaluate(() => {
                    if (window.startAnimation) {
                        window.startAnimation();
                    } else {
                        // 兼容旧版如果没刷新页面
                         if (window.writer) {
                            window.animationStarted = true;
                            window.writer.animateCharacter({
                                onProgress: (progress) => { window.animationProgress = progress; },
                                onComplete: () => { window.animationFinished = true; }
                            });
                        }
                    }
                });
            }
            
            // 检查动画是否完成
            const isFinished = await page.evaluate(() => window.animationFinished === true);
            
            if (isFinished) {
                if (finishedFrameCount === 0) {
                    console.log('动画已完成，继续录制结尾...');
                }
                finishedFrameCount++;
                if (finishedFrameCount >= extraFramesAfterFinish) {
                    console.log('录制完成。');
                    break;
                }
            }
            
            // 安全限制
            if (frameCount >= maxFrames) {
                console.warn('达到最大录制帧数限制，强制停止。');
                break;
            }
            
            // 等待下一帧
            await page.waitForTimeout(frameInterval);
            
            // 显示进度
            if ((frameCount + 1) % 10 === 0) {
                process.stdout.write(`\r已录制 ${frameCount + 1} 帧...`);
            }
            
            frameCount++;
        }
        
        console.log('\n开始生成GIF...');
        
        const outputPath = path.join(CONFIG.outputDir, `${character}.gif`);
        
        // 使用FFmpeg生成GIF
        if (checkFFmpeg()) {
            console.log('使用FFmpeg生成GIF...');
            const outputWidth = CONFIG.width + 40;
            const outputHeight = CONFIG.height + 40;
            const ffmpegCmd = `ffmpeg -y -framerate ${CONFIG.fps} -i "${path.join(tempFrameDir, 'frame%04d.png')}" -vf "scale=${outputWidth}:${outputHeight}:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse" "${outputPath}"`;
            execSync(ffmpegCmd, { stdio: 'inherit' });
            console.log(`✓ GIF生成完成: ${outputPath}`);
        } else {
            console.warn('\n⚠️  FFmpeg未安装，无法自动生成GIF。');
            console.log('PNG帧已保存在:', tempFrameDir);
            console.log('\n请安装FFmpeg后运行以下命令生成GIF:');
            const outputWidth = CONFIG.width + 40;
            const outputHeight = CONFIG.height + 40;
            console.log(`ffmpeg -y -framerate ${CONFIG.fps} -i "${path.join(tempFrameDir, 'frame%04d.png')}" -vf "scale=${outputWidth}:${outputHeight}:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse" "${outputPath}"`);
            console.log('\n或安装FFmpeg:');
            console.log('  macOS: brew install ffmpeg');
            console.log('  Linux: sudo apt-get install ffmpeg');
            throw new Error('需要FFmpeg来生成GIF');
        }
        
        // 清理临时文件
        const files = fs.readdirSync(tempFrameDir);
        for (const file of files) {
            fs.unlinkSync(path.join(tempFrameDir, file));
        }
        fs.rmdirSync(tempFrameDir);
        
        return outputPath;
        
    } catch (error) {
        console.error('生成GIF时出错:', error);
        throw error;
    } finally {
        await browser.close();
    }
}

// 从JSON文件读取汉字列表
function getCharactersFromJSON(jsonPath) {
    try {
        const jsonData = fs.readFileSync(jsonPath, 'utf-8');
        const data = JSON.parse(jsonData);

        // 支持简化格式: ["中","文"]
        if (Array.isArray(data)) {
            const characters = data
                .filter(item => typeof item === 'string' && item.trim())
                .map(item => item.trim());
            return [...new Set(characters)];
        }

        // 兼容旧格式: { data: { records: [ { word: "中" } ] } }
        const words = [];
        if (data.data && data.data.records) {
            data.data.records.forEach(record => {
                if (record.word) {
                    words.push(record.word);
                }
            });
        }

        return [...new Set(words)];
    } catch (error) {
        console.error('读取JSON文件失败:', error);
        throw error;
    }
}

// 并发控制函数
async function runWithConcurrencyLimit(tasks, concurrency = 3) {
    const results = [];
    const errors = [];
    const skipped = [];
    let index = 0;
    
    const runTask = async (character, taskIndex) => {
        // 检查文件是否已存在
        const outputPath = path.join(CONFIG.outputDir, `${character}.gif`);
        if (fs.existsSync(outputPath)) {
            skipped.push({ character, path: outputPath });
            console.log(`⊘ [${taskIndex + 1}/${tasks.length}] 跳过 "${character}" (文件已存在): ${outputPath}`);
            return;
        }
        
        try {
            console.log(`\n[${taskIndex + 1}/${tasks.length}] 开始生成汉字 "${character}" 的GIF...`);
            const generatedPath = await generateGIF(character);
            results.push({ character, path: generatedPath, success: true });
            console.log(`✓ [${taskIndex + 1}/${tasks.length}] 成功！GIF文件已保存到: ${generatedPath}`);
        } catch (error) {
            console.error(`✗ [${taskIndex + 1}/${tasks.length}] 生成失败: ${error.message}`);
            errors.push({ character, error: error.message });
        }
    };
    
    // 创建并发池
    const workers = [];
    for (let i = 0; i < concurrency; i++) {
        workers.push((async () => {
            while (index < tasks.length) {
                const currentIndex = index++;
                if (currentIndex < tasks.length) {
                    await runTask(tasks[currentIndex], currentIndex);
                }
            }
        })());
    }
    
    // 等待所有工作线程完成
    await Promise.all(workers);
    
    return { results, errors, skipped };
}

// 主函数
async function main() {
    // 检查是否提供了JSON文件路径
    const jsonPath = process.argv[2];
    let characters = [];
    let concurrency = 3; // 默认并发数
    
    // 检查是否有并发数参数
    if (process.argv[3] && !isNaN(parseInt(process.argv[3]))) {
        concurrency = parseInt(process.argv[3]);
    }
    
    if (jsonPath && jsonPath.endsWith('.json')) {
        // 从JSON文件读取汉字列表
        console.log(`从文件读取汉字列表: ${jsonPath}`);
        characters = getCharactersFromJSON(jsonPath);
        console.log(`找到 ${characters.length} 个汉字: ${characters.join(', ')}`);
        console.log(`并发数: ${concurrency}`);
    } else {
        // 单个汉字模式
        const character = process.argv[2] || CONFIG.character;
        characters = [character];
    }
    
    if (characters.length === 0) {
        console.error('没有找到要生成的汉字');
        process.exit(1);
    }
    
    // 并行生成每个汉字的GIF
    const startTime = Date.now();
    const { results, errors, skipped } = await runWithConcurrencyLimit(characters, concurrency);
    const endTime = Date.now();
    const duration = ((endTime - startTime) / 1000 / 60).toFixed(2);
    
    // 输出总结
    console.log(`\n========== 生成完成 ==========`);
    console.log(`总耗时: ${duration} 分钟`);
    console.log(`成功: ${results.length} 个`);
    console.log(`跳过: ${skipped.length} 个 (文件已存在)`);
    console.log(`失败: ${errors.length} 个`);
    
    if (errors.length > 0) {
        console.log(`\n失败的汉字:`);
        errors.forEach(({ character, error }) => {
            console.log(`  - ${character}: ${error}`);
        });
    }
}

// 运行
if (require.main === module) {
    main();
}

module.exports = { generateGIF };

