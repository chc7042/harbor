import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Header from '../components/Header';
import {
  CheckCircle,
  XCircle,
  AlertCircle,
  Clock,
  ExternalLink,
  Tag,
  ChevronRight,
  ChevronDown,
  Folder,
  FolderOpen,
  ChevronUp,
  File,
  RefreshCw
} from 'lucide-react';
import api from '../services/api';
import toast from 'react-hot-toast';

// 프로젝트/폴더의 전체 상태를 계산하는 함수
const calculateProjectStatus = (project) => {
  console.log('Calculating status for project:', project.name, project); // 디버깅
  
  const collectAllJobs = (item) => {
    let jobs = [];
    
    // 직접적인 jobs
    if (item.jobs && Array.isArray(item.jobs) && item.jobs.length > 0) {
      console.log('Found direct jobs in', item.name, ':', item.jobs.length); // 디버깅
      jobs.push(...item.jobs);
    }
    
    // 하위 폴더들의 jobs (재귀적으로)
    if (item.folders && Array.isArray(item.folders) && item.folders.length > 0) {
      console.log('Found folders in', item.name, ':', item.folders.length); // 디버깅
      item.folders.forEach(folder => {
        jobs.push(...collectAllJobs(folder));
      });
    }
    
    return jobs;
  };

  const allJobs = collectAllJobs(project);
  console.log('All jobs collected for', project.name, ':', allJobs.length, allJobs); // 디버깅
  
  if (allJobs.length === 0) {
    console.log('No jobs found for', project.name, '- returning unknown'); // 디버깅
    return 'ABORTED'; // unknown 대신 더 중립적인 상태 사용
  }

  // 마지막 빌드 결과들을 수집
  const buildResults = allJobs
    .map(job => {
      const result = job.lastBuild?.result;
      console.log('Job', job.name, 'lastBuild result:', result); // 디버깅
      return result;
    })
    .filter(result => result);

  console.log('Build results for', project.name, ':', buildResults); // 디버깅

  if (buildResults.length === 0) {
    console.log('No build results found for', project.name, '- returning ABORTED'); // 디버깅
    return 'ABORTED';
  }

  // 우선순위: FAILURE > UNSTABLE > SUCCESS
  if (buildResults.includes('FAILURE')) {
    console.log('Found FAILURE in', project.name); // 디버깅
    return 'FAILURE';
  }
  if (buildResults.includes('UNSTABLE')) {
    console.log('Found UNSTABLE in', project.name); // 디버깅
    return 'UNSTABLE';
  }
  if (buildResults.includes('SUCCESS')) {
    console.log('Found SUCCESS in', project.name); // 디버깅
    return 'SUCCESS';
  }
  
  console.log('No valid status found for', project.name, '- returning ABORTED'); // 디버깅
  return 'ABORTED';
};

// Jenkins 프로젝트/폴더 트리 컴포넌트 (재귀적으로 중첩된 폴더 처리)
const JenkinsProjectTree = ({ 
  project, 
  expandedProjects, 
  toggleProject, 
  getStatusIcon, 
  getStatusBadge,
  formatTimestamp,
  formatDuration,
  handleSort,
  getSortIcon,
  depth = 0 
}) => {
  // 중첩된 폴더를 위한 고유 키 생성
  const projectKey = project.fullName || project.name;
  const isExpanded = expandedProjects.has(projectKey);
  const hasSubItems = (project.jobs && project.jobs.length > 0) || (project.folders && project.folders.length > 0);
  const isFolder = project._class === 'com.cloudbees.hudson.plugins.folder.Folder' || project.folders || hasSubItems;
  
  console.log('Project:', project.name, 'hasSubItems:', hasSubItems, 'isFolder:', isFolder, 'jobs:', project.jobs?.length, 'folders:', project.folders?.length);
  const indentLevel = depth * 20; // 들여쓰기 레벨
  
  // 프로젝트의 전체 상태를 계산
  const projectStatus = calculateProjectStatus(project);

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200" style={{ marginLeft: `${indentLevel}px` }}>
      {/* 프로젝트/폴더 헤더 */}
      <div
        className="flex items-center justify-between p-4 cursor-pointer hover:bg-gray-50 transition-colors border-b border-gray-100"
        onClick={() => toggleProject(projectKey)}
      >
        <div className="flex items-center space-x-3">
          <button className="text-gray-400 hover:text-gray-600">
            {hasSubItems ? (
              isExpanded ? (
                <ChevronDown className="w-5 h-5" />
              ) : (
                <ChevronRight className="w-5 h-5" />
              )
            ) : (
              <div className="w-5 h-5"></div>
            )}
          </button>
          
          {isFolder ? (
            isExpanded ? (
              <FolderOpen className="w-6 h-6 text-blue-500" />
            ) : (
              <Folder className="w-6 h-6 text-blue-600" />
            )
          ) : (
            <File className="w-6 h-6 text-green-600" />
          )}
          
          <div>
            <h3 className="text-lg font-semibold text-gray-900">{project.name}</h3>
            <p className="text-sm text-gray-500">
              {(() => {
                const collectAllJobs = (item) => {
                  let jobs = [];
                  if (item.jobs && item.jobs.length > 0) {
                    jobs.push(...item.jobs);
                  }
                  if (item.folders && item.folders.length > 0) {
                    item.folders.forEach(folder => {
                      jobs.push(...collectAllJobs(folder));
                    });
                  }
                  return jobs;
                };
                const totalJobs = collectAllJobs(project).length;
                const folderCount = project.folders?.length || 0;
                
                if (totalJobs > 0 && folderCount > 0) {
                  return `${totalJobs}개 작업, ${folderCount}개 폴더`;
                } else if (totalJobs > 0) {
                  return `${totalJobs}개 작업`;
                } else if (folderCount > 0) {
                  return `${folderCount}개 폴더`;
                } else {
                  return '작업 없음';
                }
              })()}
            </p>
          </div>
        </div>
        
        <div className="flex items-center space-x-2">
          {getStatusBadge(projectStatus)}
        </div>
      </div>

      {/* 하위 항목들 */}
      {isExpanded && (
        <div className="p-4">
          {/* 하위 폴더들 (재귀적 처리) */}
          {project.folders && project.folders.map((folder) => (
            <JenkinsProjectTree
              key={folder.fullName || folder.name}
              project={folder}
              expandedProjects={expandedProjects}
              toggleProject={toggleProject}
              getStatusIcon={getStatusIcon}
              getStatusBadge={getStatusBadge}
              formatTimestamp={formatTimestamp}
              formatDuration={formatDuration}
              handleSort={handleSort}
              getSortIcon={getSortIcon}
              depth={depth + 1}
            />
          ))}
          
          {/* 작업 목록 테이블 */}
          {project.jobs && project.jobs.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full table-fixed">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="w-1/4 px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      작업 이름
                    </th>
                    <th className="w-1/8 px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                      상태
                    </th>
                    <th className="w-1/5 px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                      마지막 빌드
                    </th>
                    <th className="w-1/8 px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                      결과
                    </th>
                    <th className="w-1/8 px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                      소요 시간
                    </th>
                    <th className="w-1/8 px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                      빌드 번호
                    </th>
                    <th className="w-16 px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                      액션
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {project.jobs.map((job) => (
                    <tr key={job.fullName} className="hover:bg-gray-50">
                      <td className="w-1/4 px-4 py-3 truncate">
                        <div className="flex items-center space-x-2">
                          {getStatusIcon(job.lastBuild?.result)}
                          <span className="text-sm font-medium text-gray-900 truncate" title={job.name}>
                            {job.name}
                          </span>
                        </div>
                      </td>
                      <td className="w-1/8 px-4 py-3 text-center">
                        {getStatusBadge(job.lastBuild?.result)}
                      </td>
                      <td className="w-1/5 px-4 py-3 text-center text-sm text-gray-500 truncate" title={formatTimestamp(job.lastBuild?.timestamp)}>
                        {formatTimestamp(job.lastBuild?.timestamp)}
                      </td>
                      <td className="w-1/8 px-4 py-3 text-center text-sm text-gray-500">
                        {job.lastBuild?.result || '-'}
                      </td>
                      <td className="w-1/8 px-4 py-3 text-center text-sm text-gray-500">
                        <div className="flex items-center justify-center space-x-1">
                          <Clock className="w-3 h-3 flex-shrink-0" />
                          <span className="truncate">{formatDuration(job.lastBuild?.duration)}</span>
                        </div>
                      </td>
                      <td className="w-1/8 px-4 py-3 text-center text-sm text-gray-500">
                        <div className="flex items-center justify-center space-x-1">
                          <Tag className="w-3 h-3 flex-shrink-0" />
                          <span>#{job.lastBuild?.number || '-'}</span>
                        </div>
                      </td>
                      <td className="w-16 px-4 py-3 text-center text-sm text-gray-500">
                        {job.url && (
                          <a
                            href={job.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 hover:text-blue-800 inline-block"
                            title="Jenkins에서 보기"
                          >
                            <ExternalLink className="w-4 h-4" />
                          </a>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const Projects = () => {
  const navigate = useNavigate();
  const [projects, setProjects] = useState([]);
  const [allJobs, setAllJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [expandedProjects, setExpandedProjects] = useState(new Set(
    projects.map(project => project.name)
  ));
  const [sortConfig, setSortConfig] = useState({
    field: 'lastBuild.timestamp',
    direction: 'desc'
  });

  useEffect(() => {
    fetchProjects();
    
    // 1분마다 자동 업데이트
    const interval = setInterval(() => {
      fetchProjects(true); // true = 자동 새로고침 (토스트 표시 안함)
    }, 60000); // 60초

    return () => clearInterval(interval);
  }, []);


  const fetchProjects = async (isAutoRefresh = false) => {
    try {
      if (isAutoRefresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      // 전체 Jenkins 작업 조회 (all=true 파라미터로 모든 job 포함)
      const response = await api.get('/projects?all=true');
      
      const projectsData = response.data?.data || response.data || [];
      
      // 특별 처리: projects 폴더의 하위 항목들을 실제 프로젝트로 변환
      const processedProjects = [];
      
      for (const project of projectsData) {
        if (project.name === 'projects' && project.jobs && project.jobs.length > 0) {
          // projects 폴더의 하위 항목들(1.2.0, 2.0.0, 3.0.0 등)을 각각 개별 프로젝트로 처리
          for (const subProject of project.jobs) {
            try {
              // 각 하위 프로젝트의 상세 정보를 가져오기
              const detailResponse = await api.get(`/projects/${subProject.name}?all=true`);
              const detailData = detailResponse.data?.data;
              
              if (detailData) {
                processedProjects.push({
                  ...detailData,
                  _class: 'com.cloudbees.hudson.plugins.folder.Folder', // 폴더로 표시
                  fullName: `projects/${subProject.name}`,
                  url: subProject.url
                });
              }
            } catch (error) {
              console.error(`Failed to fetch details for ${subProject.name}:`, error);
              // 상세 정보를 가져올 수 없으면 기본 구조로 추가
              processedProjects.push({
                ...subProject,
                _class: 'com.cloudbees.hudson.plugins.folder.Folder',
                fullName: `projects/${subProject.name}`,
                jobs: [] // 빈 jobs 배열로 초기화
              });
            }
          }
        } else {
          // 다른 프로젝트들은 그대로 추가
          processedProjects.push(project);
        }
      }

      // 모든 작업들을 평면화
      const jobs = [];
      processedProjects.forEach(project => {
        if (project.jobs && project.jobs.length > 0) {
          project.jobs.forEach(job => {
            jobs.push({
              ...job,
              projectName: project.name,
              projectStatus: project.status
            });
          });
        }
      });

      console.log('Original projects:', projectsData.map(p => p.name)); // 디버깅용
      console.log('Processed projects:', processedProjects.map(p => p.name)); // 디버깅용
      console.log('Full processed project data structure:', JSON.stringify(processedProjects, null, 2)); // 전체 구조 확인
      
      // 프로젝트를 버전 번호 기준으로 내림차순 정렬 (3.0.0, 2.0.0, 1.2.0 순서)
      const sortedProjects = processedProjects.sort((a, b) => {
        console.log('Comparing:', a.name, 'vs', b.name); // 디버깅용
        
        // 더 유연한 버전 번호 추출 (1.2, 1.2.0 모두 지원)
        const versionA = a.name.match(/(\d+)\.(\d+)\.?(\d*)/);
        const versionB = b.name.match(/(\d+)\.(\d+)\.?(\d*)/);
        
        if (versionA && versionB) {
          const parseVersion = (match) => {
            return [
              parseInt(match[1], 10) || 0, // 메이저
              parseInt(match[2], 10) || 0, // 마이너  
              parseInt(match[3], 10) || 0  // 패치
            ];
          };
          
          const vA = parseVersion(versionA);
          const vB = parseVersion(versionB);
          
          console.log('Parsed versions:', a.name, vA, 'vs', b.name, vB); // 디버깅용
          
          // 메이저, 마이너, 패치 버전을 차례로 비교 (내림차순)
          for (let i = 0; i < 3; i++) {
            if (vA[i] !== vB[i]) {
              const result = vB[i] - vA[i];
              console.log(`Difference at position ${i}: ${vB[i]} - ${vA[i]} = ${result}`); // 디버깅용
              return result; // 내림차순
            }
          }
          return 0; // 동일한 버전
        }
        
        // 버전이 없는 경우 이름으로 정렬
        return b.name.localeCompare(a.name);
      });
      
      console.log('Sorted projects:', sortedProjects.map(p => p.name)); // 디버깅용

      setProjects(sortedProjects);
      setAllJobs(jobs);
      
      // 모든 프로젝트와 하위 폴더들을 기본적으로 펼쳐진 상태로 설정
      const getAllProjectKeys = (projects) => {
        const keys = [];
        projects.forEach(project => {
          keys.push(project.fullName || project.name);
          if (project.folders && project.folders.length > 0) {
            keys.push(...getAllProjectKeys(project.folders));
          }
        });
        return keys;
      };
      setExpandedProjects(new Set(getAllProjectKeys(sortedProjects)));
      
    } catch (error) {
      console.error('Failed to fetch projects:', error);
      if (!isAutoRefresh) {
        toast.error('프로젝트 목록을 불러오는데 실패했습니다.');
      }
      setProjects([]);
      setAllJobs([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
      setLastUpdated(new Date());
    }
  };

  const handleManualRefresh = () => {
    fetchProjects(false); // false = 수동 새로고침 (토스트 표시)
  };

  const toggleProject = (projectName) => {
    console.log('Toggle project called for:', projectName); // 디버깅
    console.log('Current expanded projects:', Array.from(expandedProjects)); // 디버깅
    
    const newExpanded = new Set(expandedProjects);
    if (newExpanded.has(projectName)) {
      console.log('Collapsing:', projectName); // 디버깅
      newExpanded.delete(projectName);
    } else {
      console.log('Expanding:', projectName); // 디버깅
      newExpanded.add(projectName);
    }
    
    console.log('New expanded projects:', Array.from(newExpanded)); // 디버깅
    setExpandedProjects(newExpanded);
  };


  const getStatusIcon = (status) => {
    switch (status) {
      case 'SUCCESS':
        return <CheckCircle className="w-4 h-4 text-green-500" />;
      case 'FAILURE':
        return <XCircle className="w-4 h-4 text-red-500" />;
      case 'UNSTABLE':
        return <AlertCircle className="w-4 h-4 text-yellow-500" />;
      case 'ABORTED':
        return <XCircle className="w-4 h-4 text-gray-500" />;
      default:
        return <AlertCircle className="w-4 h-4 text-gray-400" />;
    }
  };

  const getStatusBadge = (status) => {
    const styles = {
      SUCCESS: 'bg-green-100 text-green-800 border-green-200',
      FAILURE: 'bg-red-100 text-red-800 border-red-200',
      UNSTABLE: 'bg-yellow-100 text-yellow-800 border-yellow-200',
      ABORTED: 'bg-gray-100 text-gray-800 border-gray-200'
    };
    
    const labels = {
      SUCCESS: '성공',
      FAILURE: '실패',
      UNSTABLE: '불안정',
      ABORTED: '중단'
    };

    return (
      <span className={`inline-flex items-center px-2 py-1 rounded-md text-xs font-medium border ${styles[status] || styles.ABORTED}`}>
        {labels[status] || '알 수 없음'}
      </span>
    );
  };

  const formatTimestamp = (timestamp) => {
    if (!timestamp) return '-';
    const date = new Date(timestamp);
    return date.toLocaleString('ko-KR', {
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  };

  const formatDuration = (milliseconds) => {
    if (!milliseconds) return '-';
    const seconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) {
      return `${hours}시간 ${minutes % 60}분 ${seconds % 60}초`;
    } else if (minutes > 0) {
      return `${minutes}분 ${seconds % 60}초`;
    } else {
      return `${seconds}초`;
    }
  };

  const handleSort = (field) => {
    if (sortConfig?.field === field) {
      setSortConfig({
        field,
        direction: sortConfig.direction === 'asc' ? 'desc' : 'asc'
      });
    } else {
      setSortConfig({
        field,
        direction: 'desc'
      });
    }
  };

  const getSortIcon = (field) => {
    if (sortConfig?.field !== field) {
      return <div className="w-4 h-4" />;
    }
    return sortConfig.direction === 'asc' ?
      <ChevronUp className="w-4 h-4 text-primary-600" /> :
      <ChevronDown className="w-4 h-4 text-primary-600" />;
  };

  const getSortedJobs = () => {
    if (!sortConfig.field) return allJobs;
    
    return [...allJobs].sort((a, b) => {
      let aValue, bValue;
      
      if (sortConfig.field === 'lastBuild.timestamp') {
        aValue = a.lastBuild?.timestamp || 0;
        bValue = b.lastBuild?.timestamp || 0;
      } else if (sortConfig.field === 'lastBuild.result') {
        aValue = a.lastBuild?.result || '';
        bValue = b.lastBuild?.result || '';
      } else if (sortConfig.field === 'lastBuild.duration') {
        aValue = a.lastBuild?.duration || 0;
        bValue = b.lastBuild?.duration || 0;
      } else if (sortConfig.field === 'lastBuild.number') {
        aValue = a.lastBuild?.number || 0;
        bValue = b.lastBuild?.number || 0;
      } else if (sortConfig.field === 'name') {
        aValue = a.name || '';
        bValue = b.name || '';
      } else {
        aValue = a[sortConfig.field] || '';
        bValue = b[sortConfig.field] || '';
      }

      if (sortConfig.direction === 'asc') {
        return aValue > bValue ? 1 : -1;
      } else {
        return aValue < bValue ? 1 : -1;
      }
    });
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-primary-50">
        <Header />
        <main className="container-max section-padding">
          <div className="flex items-center justify-center h-64">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-900"></div>
          </div>
        </main>
      </div>
    );
  }

  const sortedJobs = getSortedJobs();
  const jobsByProject = {};
  sortedJobs.forEach(job => {
    if (!jobsByProject[job.projectName]) {
      jobsByProject[job.projectName] = [];
    }
    jobsByProject[job.projectName].push(job);
  });

  return (
    <div className="min-h-screen bg-primary-50">
      <Header />

      <main className="container-max section-padding space-responsive">
        {/* 페이지 헤더 */}
        <div className="mb-8 flex justify-between items-start">
          <div>
            <h1 className="text-3xl font-bold text-primary-900 mb-2">
              프로젝트 관리
            </h1>
            <p className="text-primary-600">
              Jenkins 프로젝트별 작업 현황을 확인하세요
            </p>
            {lastUpdated && (
              <p className="text-sm text-gray-500 mt-1">
                마지막 업데이트: {lastUpdated.toLocaleTimeString('ko-KR')}
              </p>
            )}
          </div>
          
          {/* 새로고침 버튼 */}
          <button
            onClick={handleManualRefresh}
            disabled={loading || refreshing}
            className={`flex items-center space-x-2 px-4 py-2 rounded-lg border transition-colors ${
              loading || refreshing
                ? 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed'
                : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50 hover:border-gray-400'
            }`}
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
            <span className="text-sm font-medium">
              {refreshing ? '업데이트 중...' : '새로고침'}
            </span>
          </button>
        </div>


        {/* Jenkins 폴더 및 작업 목록 */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200">
          <div className="p-4">
            <h3 className="text-base font-semibold text-gray-900 mb-3">
              프로젝트 목록 ({projects.length}개 프로젝트)
            </h3>
            
            <div className="space-y-1">
              {projects.map((project) => {
            const projectKey = project.fullName || project.name;
            const isExpanded = expandedProjects.has(projectKey);
            
            // Jenkins 폴더/프로젝트 판별 로직 개선
            const hasJobs = project.jobs && Array.isArray(project.jobs) && project.jobs.length > 0;
            const hasFolders = project.folders && Array.isArray(project.folders) && project.folders.length > 0;
            const isJenkinsFolder = project._class === 'com.cloudbees.hudson.plugins.folder.Folder';
            const hasSubItems = hasJobs || hasFolders || isJenkinsFolder;
            
            console.log(`Project: ${project.name}, _class: ${project._class}, hasJobs: ${hasJobs}, hasFolders: ${hasFolders}, isJenkinsFolder: ${isJenkinsFolder}, hasSubItems: ${hasSubItems}, isExpanded: ${isExpanded}, data:`, project);
            
            return (
              <div key={project.name} className="border border-gray-200 rounded-md">
                {/* 프로젝트 헤더 */}
                <div
                  className="flex items-center justify-between p-3 cursor-pointer hover:bg-gray-50 transition-colors"
                  onClick={() => {
                    console.log(`Clicked on project: ${project.name}`);
                    toggleProject(projectKey);
                  }}
                >
                  <div className="flex items-center space-x-3">
                    <button className="text-gray-400 hover:text-gray-600">
                      {hasSubItems ? (
                        isExpanded ? (
                          <ChevronDown className="w-5 h-5" />
                        ) : (
                          <ChevronRight className="w-5 h-5" />
                        )
                      ) : (
                        <div className="w-5 h-5"></div>
                      )}
                    </button>
                    
                    {(hasSubItems || isJenkinsFolder) ? (
                      isExpanded ? (
                        <FolderOpen className="w-6 h-6 text-blue-500" />
                      ) : (
                        <Folder className="w-6 h-6 text-blue-600" />
                      )
                    ) : (
                      <File className="w-6 h-6 text-green-600" />
                    )}
                    
                    <div>
                      <h4 className="text-sm font-medium text-gray-900">{project.name}</h4>
                      <p className="text-xs text-gray-500">
                        {hasJobs ? `${project.jobs.length}개 작업` : ''}
                        {hasJobs && hasFolders ? ', ' : ''}
                        {hasFolders ? `${project.folders.length}개 폴더` : ''}
                        {!hasJobs && !hasFolders ? '작업 없음' : ''}
                      </p>
                    </div>
                  </div>
                  
                  <div className="flex items-center space-x-2">
                    {getStatusBadge(project.status || 'ABORTED')}
                  </div>
                </div>

                {/* 하위 항목들 */}
                {isExpanded && hasSubItems && (
                  <div className="border-t border-gray-200 p-3">
                    {/* 하위 폴더들 */}
                    {project.folders && project.folders.map((folder) => (
                      <div key={folder.name} className="mb-4 ml-4">
                        <div className="text-sm text-gray-600">📁 {folder.name}</div>
                      </div>
                    ))}
                    
                    {/* 작업 목록 테이블 */}
                    {project.jobs && project.jobs.length > 0 && (
                      <div className="overflow-x-auto">
                        <table className="w-full table-fixed">
                          <thead className="bg-gray-50">
                            <tr>
                              <th className="w-2/5 px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                작업 이름
                              </th>
                              <th className="w-1/6 px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                                상태
                              </th>
                              <th className="w-1/4 px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                                마지막 빌드
                              </th>
                              <th className="w-1/6 px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                                빌드 번호
                              </th>
                              <th className="w-16 px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                                액션
                              </th>
                            </tr>
                          </thead>
                          <tbody className="bg-white divide-y divide-gray-200">
                            {project.jobs.map((job) => (
                              <tr key={job.fullName} className="hover:bg-gray-50">
                                <td className="w-2/5 px-4 py-3 truncate">
                                  <div className="flex items-center space-x-2">
                                    {getStatusIcon(job.lastBuild?.result)}
                                    <span className="text-sm font-medium text-gray-900 truncate" title={job.name}>
                                      {job.name}
                                    </span>
                                  </div>
                                </td>
                                <td className="w-1/6 px-4 py-3 text-center">
                                  {getStatusBadge(job.lastBuild?.result)}
                                </td>
                                <td className="w-1/4 px-4 py-3 text-center text-sm text-gray-500 truncate" title={formatTimestamp(job.lastBuild?.timestamp)}>
                                  {formatTimestamp(job.lastBuild?.timestamp)}
                                </td>
                                <td className="w-1/6 px-4 py-3 text-center text-sm text-gray-500">
                                  <div className="flex items-center justify-center space-x-1">
                                    <Tag className="w-3 h-3 flex-shrink-0" />
                                    <span>#{job.lastBuild?.number || '-'}</span>
                                  </div>
                                </td>
                                <td className="w-16 px-4 py-3 text-center text-sm text-gray-500">
                                  {job.url && (
                                    <a
                                      href={job.url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-blue-600 hover:text-blue-800 inline-block"
                                      title="Jenkins에서 보기"
                                    >
                                      <ExternalLink className="w-4 h-4" />
                                    </a>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
              })}
            </div>
          </div>
        </div>

        {projects.length === 0 && (
          <div className="text-center py-12">
            <Folder className="w-12 h-12 mx-auto mb-4 text-gray-300" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">프로젝트가 없습니다</h3>
            <p className="text-gray-500">Jenkins 서버에서 프로젝트를 가져오는 중이거나 설정이 필요합니다.</p>
          </div>
        )}
      </main>

    </div>
  );
};

export default Projects;