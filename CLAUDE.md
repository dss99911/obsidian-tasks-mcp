# Obsidian Tasks MCP Plugin

## 릴리즈 체크리스트

릴리즈 전 반드시 아래 사항을 확인하세요:

### 1. 빌드 확인
```bash
cd /Users/hyun/Documents/workspace/obsidian-tasks-mcp
npm run build
```

### 2. ESLint 확인 (필수!)
```bash
npm run lint
```

**주의**: Obsidian 플러그인 리뷰봇은 다음 사항을 엄격히 검사합니다:
- `@typescript-eslint/no-explicit-any` 비활성화 금지
- Promise 적절히 처리 (void 또는 await 사용)
- async 메서드에 await 필수
- `.obsidian` 하드코딩 금지 → `this.app.vault.configDir` 사용
- `console.log` 금지 → `console.warn`, `console.error`, `console.debug` 사용

### 3. 버전 업데이트
- `manifest.json`의 version 업데이트
- `package.json`의 version 업데이트

### 4. 커밋 및 푸시
```bash
git add .
git commit -m "Release vX.X.X"
git push
```

## PR 리뷰 이슈 참고
- https://github.com/obsidianmd/obsidian-releases/pull/9311
