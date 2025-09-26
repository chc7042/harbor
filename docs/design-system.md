# Harbor - 뉴욕 스타일 디자인 시스템

## 디자인 철학

Harbor의 디자인 시스템은 **뉴욕 스타일**에서 영감을 받아 **미니멀리즘**, **기능성**, **세련됨**을 추구합니다. 복잡한 배포 정보를 명확하고 직관적으로 전달하는 것이 목표입니다.

### 핵심 원칙

1. **Less is More**: 필요한 요소만 남기고 불필요한 장식 제거
2. **Functional Beauty**: 기능성과 아름다움의 완벽한 조화
3. **Consistent Grid**: 정확한 그리드 시스템으로 질서 있는 레이아웃
4. **Readable Typography**: 가독성 최우선의 타이포그래피
5. **Purposeful Color**: 의미 있는 색상 사용

## 색상 시스템

### Primary Colors
```css
/* 메인 색상 */
--color-primary: #000000;     /* Pure Black - 메인 텍스트, 헤더 */
--color-secondary: #666666;   /* Medium Gray - 보조 텍스트 */
--color-tertiary: #999999;    /* Light Gray - 비활성 텍스트 */
```

### Background Colors
```css
/* 배경 색상 */
--color-background: #FFFFFF;  /* Pure White - 메인 배경 */
--color-surface: #F8F9FA;     /* Off White - 카드, 패널 배경 */
--color-border: #E5E7EB;      /* Light Gray - 경계선 */
--color-hover: #F3F4F6;       /* Hover 상태 배경 */
```

### Status Colors (Semantic)
```css
/* 상태 표시 색상 */
--color-success: #10B981;     /* Emerald Green - 성공 */
--color-error: #EF4444;       /* Red - 실패, 오류 */
--color-warning: #F59E0B;     /* Amber - 진행중, 경고 */
--color-info: #3B82F6;        /* Blue - 정보, 링크 */
```

### Usage Guidelines
- **Primary Black**: 제목, 중요한 텍스트, 아이콘
- **Secondary Gray**: 본문 텍스트, 설명
- **Surface**: 카드 배경, 사이드바
- **Status Colors**: 배포 상태, 알림에만 사용

## 타이포그래피

### Font Stack
```css
/* 기본 폰트 */
font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'SF Pro Display',
             'Segoe UI', Roboto, sans-serif;

/* 모노스페이스 (코드, 경로) */
font-family: 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono',
             'Consolas', monospace;
```

### Typography Scale
```css
/* 제목 계층 */
.text-display {    /* 48px - 페이지 타이틀 */
  font-size: 3rem;
  font-weight: 700;
  line-height: 1.1;
}

.text-h1 {         /* 32px - 섹션 제목 */
  font-size: 2rem;
  font-weight: 600;
  line-height: 1.2;
}

.text-h2 {         /* 24px - 카드 제목 */
  font-size: 1.5rem;
  font-weight: 600;
  line-height: 1.3;
}

.text-h3 {         /* 20px - 서브 제목 */
  font-size: 1.25rem;
  font-weight: 500;
  line-height: 1.4;
}

/* 본문 텍스트 */
.text-body {       /* 16px - 기본 본문 */
  font-size: 1rem;
  font-weight: 400;
  line-height: 1.6;
}

.text-body-sm {    /* 14px - 작은 본문 */
  font-size: 0.875rem;
  font-weight: 400;
  line-height: 1.5;
}

.text-caption {    /* 12px - 캡션, 메타데이터 */
  font-size: 0.75rem;
  font-weight: 400;
  line-height: 1.4;
}
```

## 스페이싱 시스템

### Spacing Scale (8pt Grid)
```css
/* 8의 배수 기반 스페이싱 */
--space-1: 0.25rem;   /* 4px */
--space-2: 0.5rem;    /* 8px */
--space-3: 0.75rem;   /* 12px */
--space-4: 1rem;      /* 16px */
--space-5: 1.25rem;   /* 20px */
--space-6: 1.5rem;    /* 24px */
--space-8: 2rem;      /* 32px */
--space-10: 2.5rem;   /* 40px */
--space-12: 3rem;     /* 48px */
--space-16: 4rem;     /* 64px */
--space-20: 5rem;     /* 80px */
--space-24: 6rem;     /* 96px */
```

### Layout Spacing
- **Container**: 최대 1200px, 양쪽 24px 여백
- **Section**: 상하 64px 여백
- **Card**: 24px 패딩
- **Component**: 16px 간격

## 컴포넌트 스타일 가이드

### 1. 카드 (Cards)
```css
.card {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: var(--space-6);
  transition: all 0.2s ease;
}

.card:hover {
  border-color: var(--color-tertiary);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
}
```

### 2. 버튼 (Buttons)
```css
/* Primary Button */
.btn-primary {
  background: var(--color-primary);
  color: white;
  border: none;
  padding: var(--space-3) var(--space-6);
  border-radius: 6px;
  font-weight: 500;
  transition: all 0.2s ease;
}

.btn-primary:hover {
  background: var(--color-secondary);
}

/* Secondary Button */
.btn-secondary {
  background: transparent;
  color: var(--color-primary);
  border: 1px solid var(--color-border);
  padding: var(--space-3) var(--space-6);
  border-radius: 6px;
  font-weight: 500;
}
```

### 3. 입력 필드 (Form Inputs)
```css
.input {
  width: 100%;
  padding: var(--space-3) var(--space-4);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  font-size: 1rem;
  transition: border-color 0.2s ease;
}

.input:focus {
  outline: none;
  border-color: var(--color-info);
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
}
```

### 4. 상태 배지 (Status Badges)
```css
.badge {
  display: inline-flex;
  align-items: center;
  padding: var(--space-1) var(--space-3);
  border-radius: 12px;
  font-size: 0.75rem;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.badge-success {
  background: rgba(16, 185, 129, 0.1);
  color: var(--color-success);
}

.badge-error {
  background: rgba(239, 68, 68, 0.1);
  color: var(--color-error);
}

.badge-warning {
  background: rgba(245, 158, 11, 0.1);
  color: var(--color-warning);
}
```

## 레이아웃 시스템

### 1. 헤더 (Header)
```
┌─────────────────────────────────────────────────────────┐
│  [Logo] Harbor              [User Info] [Logout] │
│                                                         │
└─────────────────────────────────────────────────────────┘
```
- 높이: 64px
- 배경: Pure White
- 하단 보더: 1px solid #E5E7EB

### 2. 대시보드 그리드
```
┌─────────────────────────────────────────────────────────┐
│  [Statistics Cards - 4 columns]                        │
├─────────────────────────────────────────────────────────┤
│  [Project Cards Grid - Responsive]                     │
├─────────────────────────────────────────────────────────┤
│  [Recent Deployments Table]                            │
└─────────────────────────────────────────────────────────┘
```

### 3. 그리드 시스템
- **데스크톱**: 12 columns, 24px gutters
- **태블릿**: 8 columns, 16px gutters
- **모바일**: 4 columns, 16px gutters

## 애니메이션 가이드라인

### Transition Timing
```css
/* 표준 전환 */
transition: all 0.2s ease;

/* 빠른 전환 (hover) */
transition: all 0.15s ease;

/* 긴 전환 (페이지 전환) */
transition: all 0.3s ease;
```

### Easing Functions
- **ease**: 일반적인 상호작용
- **ease-in-out**: 페이지 전환
- **ease-out**: 등장 애니메이션

## 아이콘 시스템

### Icon Library
- **Primary**: Heroicons (outline & solid)
- **Size**: 16px, 20px, 24px
- **Color**: 텍스트 색상과 동일

### 사용 예시
```jsx
// 성공 상태
<CheckCircleIcon className="h-5 w-5 text-emerald-500" />

// 실패 상태
<XCircleIcon className="h-5 w-5 text-red-500" />

// 진행중
<ClockIcon className="h-5 w-5 text-amber-500" />
```

## 다크모드 (향후 확장)

현재는 라이트 모드만 지원하지만, 향후 다크모드 확장 시:

```css
@media (prefers-color-scheme: dark) {
  :root {
    --color-primary: #FFFFFF;
    --color-background: #000000;
    --color-surface: #1F2937;
    /* ... */
  }
}
```

## Tailwind CSS 설정

```javascript
// tailwind.config.js
module.exports = {
  theme: {
    extend: {
      colors: {
        primary: '#000000',
        secondary: '#666666',
        surface: '#F8F9FA',
        // ... 전체 색상 시스템
      },
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
        mono: ['SF Mono', 'monospace'],
      },
      spacing: {
        // 8pt grid system
      }
    }
  }
}
```

이 디자인 시스템을 통해 일관되고 세련된 뉴욕 스타일의 UI를 구현할 수 있습니다.