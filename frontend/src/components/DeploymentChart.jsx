import { useState, useEffect, useRef } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
  Filler,
  ArcElement,
} from 'chart.js';
import { Line, Doughnut, Bar } from 'react-chartjs-2';
import clsx from 'clsx';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
  Filler,
  ArcElement
);

const DeploymentChart = ({
  data,
  type = 'success-rate',
  timeRange = '7d',
  isLoading = false,
  className = ''
}) => {
  const [activeChart, setActiveChart] = useState(type);
  const [activeTimeRange, setActiveTimeRange] = useState(timeRange);
  const chartRef = useRef(null);

  // 뉴욕 스타일 차트 기본 옵션
  const baseOptions = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: {
      mode: 'index',
      intersect: false,
    },
    plugins: {
      legend: {
        display: false, // 뉴욕 스타일: 미니멀하게 범례 숨김
      },
      tooltip: {
        backgroundColor: 'rgba(17, 24, 39, 0.95)',
        titleColor: '#F9FAFB',
        bodyColor: '#F9FAFB',
        borderColor: '#374151',
        borderWidth: 1,
        cornerRadius: 8,
        padding: 12,
        displayColors: false,
        titleFont: {
          size: 12,
          weight: '600',
        },
        bodyFont: {
          size: 11,
        },
      },
    },
    scales: {
      x: {
        grid: {
          display: false, // 뉴욕 스타일: 격자 제거
        },
        border: {
          display: false,
        },
        ticks: {
          color: '#9CA3AF',
          font: {
            size: 10,
            weight: '400',
          },
          maxTicksLimit: 6,
        },
      },
      y: {
        grid: {
          color: '#F3F4F6',
          drawBorder: false,
        },
        border: {
          display: false,
        },
        ticks: {
          color: '#9CA3AF',
          font: {
            size: 10,
            weight: '400',
          },
          maxTicksLimit: 5,
        },
      },
    },
  };

  // 성공률 차트 데이터
  const getSuccessRateData = () => {
    if (!data?.successRate) return null;

    return {
      labels: data.successRate.labels || [],
      datasets: [
        {
          label: '성공률',
          data: data.successRate.values || [],
          borderColor: '#059669', // emerald-600
          backgroundColor: 'rgba(5, 150, 105, 0.1)',
          borderWidth: 2,
          pointBackgroundColor: '#059669',
          pointBorderColor: '#FFFFFF',
          pointBorderWidth: 2,
          pointRadius: 4,
          pointHoverRadius: 6,
          fill: true,
          tension: 0.4, // 부드러운 곡선
        },
        {
          label: '실패율',
          data: data.successRate.failureValues || [],
          borderColor: '#DC2626', // red-600
          backgroundColor: 'rgba(220, 38, 38, 0.1)',
          borderWidth: 2,
          pointBackgroundColor: '#DC2626',
          pointBorderColor: '#FFFFFF',
          pointBorderWidth: 2,
          pointRadius: 4,
          pointHoverRadius: 6,
          fill: true,
          tension: 0.4,
        },
      ],
    };
  };

  // 배포 횟수 차트 데이터
  const getDeploymentCountData = () => {
    if (!data?.deploymentCount) return null;

    return {
      labels: data.deploymentCount.labels || [],
      datasets: [
        {
          label: '배포 횟수',
          data: data.deploymentCount.values || [],
          backgroundColor: '#3B82F6', // blue-500
          borderColor: '#2563EB', // blue-600
          borderWidth: 1,
          borderRadius: 4,
          borderSkipped: false,
        },
      ],
    };
  };

  // 프로젝트별 성공률 도넛 차트 데이터
  const getProjectSuccessData = () => {
    if (!data?.projectSuccess) return null;

    const colors = [
      '#059669', // emerald-600
      '#3B82F6', // blue-500
      '#F59E0B', // amber-500
      '#EF4444', // red-500
      '#8B5CF6', // violet-500
      '#06B6D4', // cyan-500
    ];

    return {
      labels: data.projectSuccess.labels || [],
      datasets: [
        {
          data: data.projectSuccess.values || [],
          backgroundColor: colors.slice(0, data.projectSuccess.labels?.length || 0),
          borderColor: '#FFFFFF',
          borderWidth: 2,
          hoverBorderWidth: 3,
        },
      ],
    };
  };

  const doughnutOptions = {
    ...baseOptions,
    cutout: '65%',
    plugins: {
      ...baseOptions.plugins,
      tooltip: {
        ...baseOptions.plugins.tooltip,
        callbacks: {
          label: function(context) {
            const label = context.label || '';
            const value = context.parsed || 0;
            return `${label}: ${value.toFixed(1)}%`;
          },
        },
      },
    },
    scales: {}, // 도넛 차트는 축이 없음
  };

  const barOptions = {
    ...baseOptions,
    scales: {
      ...baseOptions.scales,
      y: {
        ...baseOptions.scales.y,
        beginAtZero: true,
        ticks: {
          ...baseOptions.scales.y.ticks,
          callback: function(value) {
            return value + '개';
          },
        },
      },
    },
  };

  const getCurrentData = () => {
    switch (activeChart) {
      case 'success-rate':
        return getSuccessRateData();
      case 'deployment-count':
        return getDeploymentCountData();
      case 'project-success':
        return getProjectSuccessData();
      default:
        return null;
    }
  };

  const getCurrentOptions = () => {
    switch (activeChart) {
      case 'success-rate':
        return {
          ...baseOptions,
          scales: {
            ...baseOptions.scales,
            y: {
              ...baseOptions.scales.y,
              min: 0,
              max: 100,
              ticks: {
                ...baseOptions.scales.y.ticks,
                callback: function(value) {
                  return value + '%';
                },
              },
            },
          },
        };
      case 'deployment-count':
        return barOptions;
      case 'project-success':
        return doughnutOptions;
      default:
        return baseOptions;
    }
  };

  const renderChart = () => {
    const chartData = getCurrentData();
    const chartOptions = getCurrentOptions();

    if (!chartData) return null;

    switch (activeChart) {
      case 'success-rate':
        return <Line ref={chartRef} data={chartData} options={chartOptions} />;
      case 'deployment-count':
        return <Bar ref={chartRef} data={chartData} options={chartOptions} />;
      case 'project-success':
        return <Doughnut ref={chartRef} data={chartData} options={chartOptions} />;
      default:
        return null;
    }
  };

  const getChartTitle = () => {
    switch (activeChart) {
      case 'success-rate':
        return '배포 성공률 추이';
      case 'deployment-count':
        return '배포 횟수 통계';
      case 'project-success':
        return '프로젝트별 성공률';
      default:
        return '차트';
    }
  };

  const getMetrics = () => {
    if (!data?.metrics) return null;

    const metrics = data.metrics;
    return [
      {
        label: '평균 성공률',
        value: `${metrics.averageSuccessRate?.toFixed(1) || 0}%`,
        trend: metrics.successRateTrend || 0,
        icon: (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        ),
      },
      {
        label: '총 배포',
        value: metrics.totalDeployments || 0,
        trend: metrics.deploymentTrend || 0,
        icon: (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
          </svg>
        ),
      },
      {
        label: '활성 프로젝트',
        value: metrics.activeProjects || 0,
        trend: metrics.projectTrend || 0,
        icon: (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
          </svg>
        ),
      },
    ];
  };

  if (isLoading) {
    return (
      <div className={clsx('card', className)}>
        <div className="card-header">
          <div className="animate-pulse">
            <div className="h-6 bg-primary-300 rounded w-32"></div>
          </div>
        </div>
        <div className="card-body">
          <div className="animate-pulse">
            <div className="h-64 bg-primary-200 rounded"></div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={clsx('card', className)}>
      <div className="card-header">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-primary-900">
            {getChartTitle()}
          </h3>

          {/* 차트 타입 선택 */}
          <div className="flex items-center space-x-1">
            {[
              { key: 'success-rate', label: '성공률', icon: '📈' },
              { key: 'deployment-count', label: '배포수', icon: '📊' },
              { key: 'project-success', label: '프로젝트', icon: '🎯' },
            ].map(({ key, label, icon }) => (
              <button
                key={key}
                onClick={() => setActiveChart(key)}
                className={clsx(
                  'px-3 py-1.5 text-xs font-medium rounded-md transition-colors',
                  activeChart === key
                    ? 'bg-primary-100 text-primary-900 border border-primary-200'
                    : 'text-primary-600 hover:bg-primary-50 hover:text-primary-900'
                )}
                title={label}
              >
                <span className="mr-1">{icon}</span>
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* 시간 범위 선택 */}
        <div className="flex items-center space-x-1 mt-3">
          {[
            { key: '24h', label: '24시간' },
            { key: '7d', label: '7일' },
            { key: '30d', label: '30일' },
            { key: '90d', label: '90일' },
          ].map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setActiveTimeRange(key)}
              className={clsx(
                'px-2 py-1 text-xs font-medium rounded transition-colors',
                activeTimeRange === key
                  ? 'bg-primary-900 text-white'
                  : 'text-primary-600 hover:bg-primary-100 hover:text-primary-900'
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* 메트릭스 요약 */}
      {getMetrics() && (
        <div className="px-6 py-3 border-b border-primary-200">
          <div className="grid grid-cols-3 gap-4">
            {getMetrics().map((metric, index) => (
              <div key={index} className="text-center">
                <div className="flex items-center justify-center space-x-1 text-primary-600 mb-1">
                  {metric.icon}
                  <span className="text-xs font-medium">{metric.label}</span>
                </div>
                <div className="flex items-center justify-center space-x-1">
                  <span className="text-lg font-bold text-primary-900">{metric.value}</span>
                  {metric.trend !== 0 && (
                    <span className={clsx(
                      'text-xs font-medium',
                      metric.trend > 0 ? 'text-success-600' : 'text-error-600'
                    )}>
                      {metric.trend > 0 ? '+' : ''}{metric.trend.toFixed(1)}%
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 차트 영역 */}
      <div className="card-body">
        <div className="h-64 w-full">
          {renderChart()}
        </div>
      </div>

      {/* 프로젝트별 성공률 범례 */}
      {activeChart === 'project-success' && data?.projectSuccess?.labels && (
        <div className="card-footer">
          <div className="flex flex-wrap gap-2">
            {data.projectSuccess.labels.map((label, index) => (
              <div key={index} className="flex items-center space-x-2">
                <div
                  className="w-3 h-3 rounded-full"
                  style={{
                    backgroundColor: [
                      '#059669', '#3B82F6', '#F59E0B', '#EF4444', '#8B5CF6', '#06B6D4'
                    ][index % 6]
                  }}
                />
                <span className="text-xs text-primary-600">{label}</span>
                <span className="text-xs font-medium text-primary-900">
                  {data.projectSuccess.values[index]?.toFixed(1)}%
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default DeploymentChart;