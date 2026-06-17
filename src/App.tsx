import React, { useState, useEffect, useRef } from 'react';
import {
  GraduationCap,
  Calendar,
  UserPlus,
  UserMinus,
  Mic,
  MicOff,
  Printer,
  Download,
  Plus,
  Trash2,
  Lock,
  Unlock,
  Check,
  AlertCircle,
  X,
  FileText,
  Search,
  BookOpen,
  ArrowRight,
  ShieldAlert,
  Save,
  Filter,
  CheckCircle,
  Clock,
  LogOut,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Info,
  Eye,
  EyeOff,
  SlidersHorizontal,
  FileSpreadsheet,
  ArrowDownCircle,
  ArrowUpCircle
} from 'lucide-react';
import { jsPDF } from 'jspdf';
import { Student, AttendanceStatus, StudentAttendance, AttendanceRecord, PRESET_TAGS, PresetTag } from './types';
import { DEFAULT_STUDENTS } from './data/defaultStudents';
import { StudentObservationInput } from './components/StudentObservationInput';
import { StudentPresetDropdown } from './components/StudentPresetDropdown';

// Firebase Integrations
import { 
  collection, 
  doc, 
  setDoc, 
  deleteDoc, 
  onSnapshot, 
  getDocFromServer,
  writeBatch,
  getDocs
} from 'firebase/firestore';
import { signInAnonymously, onAuthStateChanged, GoogleAuthProvider, signInWithPopup } from 'firebase/auth';
import { db, auth } from './lib/firebase';

const COURSES = [
  '1RO A', '1RO B', '1RO C',
  '2DO A', '2DO B', '2DO C',
  '3RO A', '3RO B', '3RO C',
  '4TO A', '4TO B', '4TO C',
  '5TO A', '5TO B', '5TO C',
  '6TO A', '6TO B', '6TO C'
] as const;

// Zero-Trust Required enum and handler from the Firebase Skill
enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

const getLocalTodayDateString = () => {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const getFirstOfMonthDateString = () => {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}-01`;
};

export default function App() {
  // --- AUTH STATES ---
  const [isAuthorized, setIsAuthorized] = useState<boolean>(() => {
    return localStorage.getItem('sadosa_auth_2026') === 'true';
  });
  const [enteredPassword, setEnteredPassword] = useState<string>('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [isLoginModalOpen, setIsLoginModalOpen] = useState<boolean>(false);
  const [showPassword, setShowPassword] = useState<boolean>(false);

  // --- ADMIN (STUDENT MGMT) STATES ---
  const [isAdminAuthorized, setIsAdminAuthorized] = useState<boolean>(false);
  const [adminPassword, setAdminPassword] = useState<string>('');
  const [adminError, setAdminError] = useState<string | null>(null);
  const [showAdminLockModal, setShowAdminLockModal] = useState<boolean>(false);

  // --- CUSTOM DIALOG CONFIRMATION ---
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string;
    message: string;
    confirmText: string;
    cancelText: string;
    onConfirm: () => void;
  } | null>(null);

  // --- CORE SYSTEM DATA STATES (Cloud-backed) ---
  const [students, setStudents] = useState<Student[]>(DEFAULT_STUDENTS);
  const [attendance, setAttendance] = useState<AttendanceRecord>({});
  const [selectedCourse, setSelectedCourse] = useState<string>('1RO A');
  const [selectedPeriod, setSelectedPeriod] = useState<string>('P1');

  // --- FIREBASE SYNC & CONNECTION ---
  const [firebaseReady, setFirebaseReady] = useState<boolean>(false);
  const [user, setUser] = useState<any>(null);

  // --- DATE & TIME ---
  const [currentDate, setCurrentDate] = useState<string>(getLocalTodayDateString); // Defaults to current local date
  const [activeTab, setActiveTab] = useState<'diario' | 'estudiantes' | 'reportes'>('diario');

  // --- GOOGLE WORKSPACE & SHEETS STATES ---
  const [googleUser, setGoogleUser] = useState<any>(null);
  const [googleToken, setGoogleToken] = useState<string | null>(null);
  const [isSyncingRoster, setIsSyncingRoster] = useState<boolean>(false);
  const [isExportingSheets, setIsExportingSheets] = useState<boolean>(false);
  const [controlPanelExpanded, setControlPanelExpanded] = useState<boolean>(false);

  // --- NEW STUDENT STATE ---
  const [newStudentName, setNewStudentName] = useState<string>('');
  const [newStudentSurname, setNewStudentSurname] = useState<string>('');
  const [newStudentCourse, setNewStudentCourse] = useState<string>('1RO A');
  const [isSeeding, setIsSeeding] = useState<boolean>(false);
  const [seedProgress, setSeedProgress] = useState<number>(0);
  const [mgmtSearch, setMgmtSearch] = useState<string>('');

  // --- VOICE SPEECH TO TEXT STATES ---
  const [listeningStudentId, setListeningStudentId] = useState<string | null>(null);
  const [speechError, setSpeechError] = useState<string | null>(null);
  const [reportStartDate, setReportStartDate] = useState<string>(getFirstOfMonthDateString);
  const [reportEndDate, setReportEndDate] = useState<string>(getLocalTodayDateString);
  const [reportSearchQuery, setReportSearchQuery] = useState<string>('');
  const [reportCourseFilter, setReportCourseFilter] = useState<string>('Todos');
  const [reportPeriodFilter, setReportPeriodFilter] = useState<string>('Todos');

  // --- FEEDBACK TOAST ---
  const [toastMessage, setToastMessage] = useState<{ text: string; type: 'success' | 'info' | 'error' } | null>(null);

  const recognitionRef = useRef<any>(null);

  // Connection testing and initial check
  useEffect(() => {
    async function testConnection() {
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (error) {
        if (error instanceof Error && error.message.includes('the client is offline')) {
          console.warn("Firebase client appears to be offline. Local cached data will be used.");
        }
      }
    }
    testConnection();
  }, []);

  // background auth to satisfy security rules
  useEffect(() => {
    const unsubscribeAuth = onAuthStateChanged(auth, async (currentUser) => {
      if (currentUser) {
        setUser(currentUser);
        setFirebaseReady(true);
      } else {
        try {
          await signInAnonymously(auth);
        } catch (error) {
          console.warn("Auto-anonymous authentication is unavailable or restricted. Continuing in offline standalone mode.", error);
          setFirebaseReady(true); // fall back to make state ready
        }
      }
    });
    return () => unsubscribeAuth();
  }, []);

  // Real-time synchronization of the students list
  useEffect(() => {
    if (!firebaseReady) return;

    const studentsCollection = collection(db, 'students');
    const unsubscribeValue = onSnapshot(studentsCollection, (snapshot) => {
      const studentList: Student[] = [];
      snapshot.forEach((docSnap) => {
        studentList.push(docSnap.data() as Student);
      });

      // Sort students by course, then by their order in sheet/preset, then fallback to name
      const sorted = studentList.sort((a, b) => {
        if (a.course !== b.course) {
          return a.course.localeCompare(b.course, 'es');
        }
        const orderA = a.order !== undefined ? a.order : 9999;
        const orderB = b.order !== undefined ? b.order : 9999;
        if (orderA !== orderB) return orderA - orderB;

        const surnameCompare = a.surname.localeCompare(b.surname, 'es');
        if (surnameCompare !== 0) return surnameCompare;
        return a.name.localeCompare(b.name, 'es');
      });

      const hasSeededBefore = localStorage.getItem('sadosa_db_seeded_v1') === 'true';

      if (sorted.length >= 750) {
        localStorage.setItem('sadosa_db_seeded_v1', 'true');
        setStudents(sorted);
      } else if (hasSeededBefore && sorted.length > 0) {
        // If it was already seeded previously, and contains at least some students,
        // let the Firestore sorted state be the sole source of truth (respecting permanent deletions and additions!)
        setStudents(sorted);
      } else {
        // If Firestore is empty or incomplete (< 750 students),
        // we merge sorted with DEFAULT_STUDENTS to ensure NO course is left empty in the UI.
        // Also, we trigger an automatic silent background batch-seed to populate Firestore with all 762 students!
        const mergedMap = new Map<string, Student>();
        
        // Start with default list
        DEFAULT_STUDENTS.forEach((st, idx) => {
          mergedMap.set(st.id, { ...st, order: st.order !== undefined ? st.order : idx + 1 });
        });
        // Overwrite/add with Firestore version
        sorted.forEach(st => {
          const existing = mergedMap.get(st.id);
          mergedMap.set(st.id, {
            ...st,
            order: st.order !== undefined ? st.order : (existing?.order !== undefined ? existing.order : 9999)
          });
        });
        
        const mergedList = Array.from(mergedMap.values()).sort((a, b) => {
          if (a.course !== b.course) {
            return a.course.localeCompare(b.course, 'es');
          }
          const orderA = a.order !== undefined ? a.order : 9999;
          const orderB = b.order !== undefined ? b.order : 9999;
          if (orderA !== orderB) return orderA - orderB;

          const surnameCompare = a.surname.localeCompare(b.surname, 'es');
          if (surnameCompare !== 0) return surnameCompare;
          return a.name.localeCompare(b.name, 'es');
        });
        setStudents(mergedList);

        // We only trigger auto-seed if we are not already seeding and we are in an empty or very small state (e.g. < 160)
        // AND have not previously finished seeding.
        if (sorted.length < 160 && !hasSeededBefore) {
          const autoBatchSeed = async () => {
            try {
              const batchList: Student[][] = [];
              const size = 300; // writeBatch allows 500 max
              for (let i = 0; i < DEFAULT_STUDENTS.length; i += size) {
                batchList.push(DEFAULT_STUDENTS.slice(i, i + size));
              }

              for (let b = 0; b < batchList.length; b++) {
                const batch = writeBatch(db);
                batchList[b].forEach((st) => {
                  const orderVal = DEFAULT_STUDENTS.indexOf(st) + 1;
                  batch.set(doc(db, 'students', st.id), {
                    id: st.id,
                    name: st.name,
                    surname: st.surname,
                    course: st.course,
                    order: orderVal,
                    createdAt: new Date().toISOString()
                  });
                });
                await batch.commit();
              }
              localStorage.setItem('sadosa_db_seeded_v1', 'true');
              console.log("Automatic initialization completed: All 762 students registered in custom Firestore.");
            } catch (err) {
              console.error("Auto seeding error:", err);
            }
          };
          autoBatchSeed();
        }
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'students');
    });

    return () => unsubscribeValue();
  }, [firebaseReady]);

  // Real-time synchronization of attendance records
  useEffect(() => {
    if (!firebaseReady) return;

    const attendanceCollection = collection(db, 'attendance');
    const unsubscribeValue = onSnapshot(attendanceCollection, (snapshot) => {
      const liveAttendance: AttendanceRecord = {};
      
      snapshot.forEach((docSnap) => {
        const item = docSnap.data();
        const date = item.date;
        const studentId = item.studentId;
        const period = item.period || 'P1';
        const key = `${date}__${period}`;
        
        if (date && studentId) {
          if (!liveAttendance[key]) {
            liveAttendance[key] = {};
          }
          
          const hasExplicitPeriod = item.period !== undefined;
          const existingRecord = liveAttendance[key][studentId];

          if (!existingRecord || hasExplicitPeriod) {
            liveAttendance[key][studentId] = {
              status: item.status || '',
              observation: item.observation || '',
              tags: item.tags || []
            };
          }
        }
      });
      
      setAttendance(liveAttendance);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'attendance');
    });

    return () => unsubscribeValue();
  }, [firebaseReady]);

  // Toast auto-clear
  useEffect(() => {
    if (toastMessage) {
      const timer = setTimeout(() => {
        setToastMessage(null);
      }, 4000);
      return () => clearTimeout(timer);
    }
  }, [toastMessage]);

  const showToast = (text: string, type: 'success' | 'info' | 'error' = 'success') => {
    setToastMessage({ text, type });
  };

  // --- LOGIN SUBMIT ---
  const handleLoginSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (enteredPassword.trim() === 'sadosa2026') {
      setIsAuthorized(true);
      setIsLoginModalOpen(false);
      setEnteredPassword('');
      localStorage.setItem('sadosa_auth_2026', 'true');
      setAuthError(null);
      showToast('Acceso Correcto. ¡Bienvenido!', 'success');
    } else {
      setAuthError('Contraseña incorrecta. Intente de nuevo.');
    }
  };

  const handleLogout = () => {
    setIsAuthorized(false);
    localStorage.removeItem('sadosa_auth_2026');
    showToast('Sesión cerrada correctamente', 'info');
  };

  // --- ADMIN CODE VERIFY ---
  const handleAdminVerify = (e: React.FormEvent) => {
    e.preventDefault();
    if (adminPassword === '2026') {
      setIsAdminAuthorized(true);
      setShowAdminLockModal(false);
      setAdminError(null);
      setAdminPassword('');
      showToast('Modo de administración desbloqueado', 'success');
    } else {
      setAdminError('Clave incorrecta. Clave de verificación necesaria.');
    }
  };

  // --- CLOUD FIRESTORE REC SAVE HELPER ---
  const saveAttendanceToFirestore = async (studentId: string, status: AttendanceStatus, observation: string, tags: string[], periodOverride?: string) => {
    const period = periodOverride || selectedPeriod;
    const docId = `${currentDate}__${period}__${studentId}`;
    try {
      await setDoc(doc(db, 'attendance', docId), {
        id: docId,
        date: currentDate,
        period,
        studentId,
        status,
        observation,
        tags,
        updatedAt: new Date().toISOString()
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `attendance/${docId}`);
    }
  };

  // --- OPTIMISTIC RECORD SAVE WRAPPER ---
  const saveAttendanceStateOptimistic = (studentId: string, status: AttendanceStatus, observation: string, tags: string[]) => {
    const activeKey = `${currentDate}__${selectedPeriod}`;
    setAttendance(prev => {
      const todayRecord = prev[activeKey] || {};
      return {
        ...prev,
        [activeKey]: {
          ...todayRecord,
          [studentId]: {
            status,
            observation,
            tags
          }
        }
      };
    });
    // Record to cloud DB asynchronously in background
    saveAttendanceToFirestore(studentId, status, observation, tags);
  };

  // --- STUDENT BUBBLE STATE CHANGER ---
  const cycleAttendance = (studentId: string) => {
    const activeKey = `${currentDate}__${selectedPeriod}`;
    const todayRecord = attendance[activeKey] || {};
    const currentStudentRec = todayRecord[studentId] || { status: '', observation: '', tags: [] };
    
    let nextStatus: AttendanceStatus = '';
    switch (currentStudentRec.status) {
      case '': nextStatus = 'A'; break;
      case 'A': nextStatus = 'R'; break;
      case 'R': nextStatus = 'L'; break;
      case 'L': nextStatus = 'F'; break;
      case 'F': nextStatus = ''; break;
    }

    saveAttendanceStateOptimistic(studentId, nextStatus, currentStudentRec.observation, currentStudentRec.tags);
  };

  // --- MANUAL ATTENDANCE OVERWRITE WITH BUTTONS IF PREFERRED ---
  const setSpecificStatus = (studentId: string, status: AttendanceStatus) => {
    const activeKey = `${currentDate}__${selectedPeriod}`;
    const todayRecord = attendance[activeKey] || {};
    const currentStudentRec = todayRecord[studentId] || { status: '', observation: '', tags: [] };
    saveAttendanceStateOptimistic(studentId, status, currentStudentRec.observation, currentStudentRec.tags);
  };

  // --- OBSERVATION TEXT UPDATE ---
  const handleObservationChange = (studentId: string, text: string) => {
    const activeKey = `${currentDate}__${selectedPeriod}`;
    const todayRecord = attendance[activeKey] || {};
    const currentStudentRec = todayRecord[studentId] || { status: '', observation: '', tags: [] };
    saveAttendanceStateOptimistic(studentId, currentStudentRec.status, text, currentStudentRec.tags);
  };

  // --- TAG PILLS SELECTION ---
  const togglePresetTag = (studentId: string, tag: PresetTag) => {
    const activeKey = `${currentDate}__${selectedPeriod}`;
    const todayRecord = attendance[activeKey] || {};
    const currentStudentRec = todayRecord[studentId] || { status: '', observation: '', tags: [] };
    
    const exists = currentStudentRec.tags.includes(tag);
    const updatedTags = exists 
      ? currentStudentRec.tags.filter(t => t !== tag)
      : [...currentStudentRec.tags, tag];

    saveAttendanceStateOptimistic(studentId, currentStudentRec.status, currentStudentRec.observation, updatedTags);
  };

  // --- MASS ASISTENCIA REGISTRATION (RESPETS R, L, F) ---
  const handleMassAttendance = async () => {
    const activeKey = `${currentDate}__${selectedPeriod}`;
    const courseStudents = students.filter(st => st.course === selectedCourse);
    const todayRecord = attendance[activeKey] || {};
    
    // Find who needs to be updated (those that currently have an empty, falsy, or spacer status)
    // We strictly preserve existing statuses, especially 'R', 'L', and 'F'.
    const studentsToUpdate = courseStudents.filter(st => {
      const rec = todayRecord[st.id];
      if (!rec) return true; // Empty record, ready to receive 'A'
      const status = rec.status ? rec.status.trim().toUpperCase() : '';
      return status === ''; // Only apply if there is no pre-existing A, R, L, F status
    });

    const updatedCount = studentsToUpdate.length;

    if (updatedCount === 0) {
      showToast(`Llamado masivo: No hay alumnos vacíos. Se respetaron todos los estados R, L y F pre-existentes de ${selectedCourse} en el periodo ${selectedPeriod}.`, 'info');
      return;
    }

    // 1. Optimistic Update of local state immediately to make it react instantly
    setAttendance(prev => {
      const currentTodayRec = { ...(prev[activeKey] || {}) };
      studentsToUpdate.forEach(st => {
        const existingRec = currentTodayRec[st.id] || { status: '', observation: '', tags: [] };
        currentTodayRec[st.id] = {
          ...existingRec,
          status: 'A'
        };
      });
      return {
        ...prev,
        [activeKey]: currentTodayRec
      };
    });

    showToast(`Registrando masivamente ${updatedCount} alumnos con Asistencia...`, 'info');

    // 2. Perform Firestore writes in the background
    const promises = studentsToUpdate.map(async (st) => {
      const existingRec = todayRecord[st.id] || { status: '', observation: '', tags: [] };
      const docId = `${currentDate}__${selectedPeriod}__${st.id}`;
      try {
        await setDoc(doc(db, 'attendance', docId), {
          id: docId,
          date: currentDate,
          period: selectedPeriod,
          studentId: st.id,
          status: 'A',
          observation: existingRec.observation || '',
          tags: existingRec.tags || [],
          updatedAt: new Date().toISOString()
        });
      } catch (error) {
        console.error(`Error saving mass attendance for student ${st.id}:`, error);
      }
    });

    try {
      await Promise.all(promises);
      showToast(`Llamado Masivo Exitoso: Se registraron ${updatedCount} alumnos con Asistencia 'A' para el periodo ${selectedPeriod}, respetando los estados R, L y F ya registrados previamente!`, 'success');
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `attendance/mass`);
    }
  };

  // --- SPEECH VOICE RECOGNITION WORKER ---
  const handleVoiceToggle = (studentId: string) => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    
    if (!SpeechRecognition) {
      showToast('La dictación por voz no está soportada en este navegador. Utilice Google Chrome.', 'error');
      setSpeechError('Navegador no soporta API de reconocimiento de voz.');
      return;
    }

    if (listeningStudentId === studentId) {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
      setListeningStudentId(null);
      return;
    }

    if (recognitionRef.current) {
      recognitionRef.current.stop();
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'es-BO';
    recognition.continuous = false;
    recognition.interimResults = false;

    recognition.onstart = () => {
      setListeningStudentId(studentId);
      setSpeechError(null);
    };

    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      if (transcript) {
        const activeKey = `${currentDate}__${selectedPeriod}`;
        const todayRecord = attendance[activeKey] || {};
        const currentStudentRec = todayRecord[studentId] || { status: '', observation: '', tags: [] };
        const separator = currentStudentRec.observation ? ' ' : '';
        const newText = currentStudentRec.observation + separator + transcript;
        saveAttendanceToFirestore(studentId, currentStudentRec.status, newText, currentStudentRec.tags);
        showToast('Texto dictado agregado.', 'success');
      }
    };

    recognition.onerror = (e: any) => {
      console.error(e);
      setSpeechError(`Error al reconocer voz: ${e.error}`);
      setListeningStudentId(null);
    };

    recognition.onend = () => {
      if (listeningStudentId === studentId) {
        setListeningStudentId(null);
      }
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch (e) {
      console.error(e);
      setListeningStudentId(null);
    }
  };

  // --- GOOGLE WORKSPACE & SHEETS SERVICES ---

  const handleGoogleSignIn = async () => {
    try {
      const provider = new GoogleAuthProvider();
      provider.addScope('https://www.googleapis.com/auth/spreadsheets');
      
      const result = await signInWithPopup(auth, provider);
      const credential = GoogleAuthProvider.credentialFromResult(result);
      if (credential?.accessToken) {
        setGoogleToken(credential.accessToken);
        setGoogleUser(result.user);
        showToast(`Conectado a Google como: ${result.user.displayName || result.user.email}`, 'success');
      } else {
        showToast('No se obtuvo el token de Google Sheets', 'error');
      }
    } catch (e: any) {
      console.error('Error Google Sign-in:', e);
      showToast(`Error al conectar con Google: ${e.message}`, 'error');
    }
  };

  const handleGoogleSignOut = () => {
    setGoogleToken(null);
    setGoogleUser(null);
    showToast('Desconectado de Google Sheets', 'info');
  };

  const ensureSheetExists = async (spreadsheetId: string, title: string) => {
    try {
      const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`, {
        headers: { Authorization: `Bearer ${googleToken}` }
      });
      if (!response.ok) return;
      const meta = await response.json();
      const sheetExists = meta.sheets?.some((s: any) => s.properties?.title === title);
      if (!sheetExists) {
        await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${googleToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            requests: [
              {
                addSheet: {
                  properties: {
                    title: title
                  }
                }
              }
            ]
          })
        });
        console.log(`Created new sheet with title "${title}"`);
      }
    } catch (e) {
      console.error('Error verifying/creating sheet: ', e);
    }
  };

  const syncRosterFromGoogleSheets = async () => {
    if (!googleToken) {
      showToast('Debe conectar su cuenta de Google para sincronizar', 'error');
      return;
    }
    
    setIsSyncingRoster(true);
    try {
      const sheetId = '1AMDubHoRNA1Hr2_XQcudyGZUYB0cP6IqcsOxfA85_oI';
      const range = encodeURIComponent("'NOMINA SEC'!A1:R250");
      const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}`, {
        headers: { Authorization: `Bearer ${googleToken}` }
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Google Sheets API respondió con un error: ${errorText}`);
      }
      
      const data = await response.json();
      const values = data.values;
      if (!values || values.length === 0) {
        showToast('La hoja de Google Sheets está vacía o no se pudo leer.', 'error');
        setIsSyncingRoster(false);
        return;
      }
      
      const sheetCourses = values[0];
      const newStudentsList: Student[] = [];
      
      for (let c = 0; c < sheetCourses.length; c++) {
        const courseName = sheetCourses[c]?.trim().toUpperCase();
        if (!courseName) continue;
        
        const validCourse = COURSES.find(v => v === courseName);
        if (!validCourse) continue;
        
        for (let r = 1; r < values.length; r++) {
          const row = values[r];
          const cellValue = row && row[c] ? row[c].trim() : '';
          if (!cellValue) continue;
          
          let surname = '';
          let name = '';
          const parts = cellValue.split(',');
          if (parts.length >= 2) {
            surname = parts[0].trim();
            name = parts.slice(1).join(',').trim();
          } else {
            const words = cellValue.split(/\s+/);
            if (words.length >= 2) {
              surname = words.slice(0, 2).join(' ');
              name = words.slice(2).join(' ');
            } else {
              surname = cellValue;
              name = '';
            }
          }
          
          const studentId = `gs__${validCourse.replace(/\s+/g, '_')}__${r}`;
          newStudentsList.push({
            id: studentId,
            name,
            surname,
            course: validCourse,
            order: r
          });
        }
      }
      
      if (newStudentsList.length === 0) {
        showToast('No se encontraron estudiantes válidos en la hoja.', 'error');
        setIsSyncingRoster(false);
        return;
      }
      
      showToast(`Cargados ${newStudentsList.length} estudiantes. Actualizando nómina...`, 'info');
      
      const timeoutPromise = (ms: number, errMsg = 'TIMEOUT') => new Promise((_, reject) => setTimeout(() => reject(new Error(errMsg)), ms));
      
      const studentsToDelete = [...students];
      const batchesToDelete: string[][] = [];
      for (let i = 0; i < studentsToDelete.length; i += 300) {
        batchesToDelete.push(studentsToDelete.slice(i, i + 300).map(s => s.id));
      }
      
      for (const batchIds of batchesToDelete) {
        const batch = writeBatch(db);
        batchIds.forEach(id => {
          batch.delete(doc(db, 'students', id));
        });
        try {
          await Promise.race([batch.commit(), timeoutPromise(6000, 'TIMEOUT_DELETE')]);
        } catch (e) {
          console.warn("Delete batch timed out or failed, continuing with insert.", e);
        }
      }
      
      const chunksOfNew: Student[][] = [];
      for (let i = 0; i < newStudentsList.length; i += 300) {
        chunksOfNew.push(newStudentsList.slice(i, i + 300));
      }
      
      let savedCount = 0;
      let hasCloudError = false;
      for (const chunk of chunksOfNew) {
        const batch = writeBatch(db);
        chunk.forEach(st => {
          batch.set(doc(db, 'students', st.id), {
            id: st.id,
            name: st.name,
            surname: st.surname,
            course: st.course,
            order: st.order || 9999,
            createdAt: new Date().toISOString()
          });
          savedCount++;
        });
        try {
          await Promise.race([batch.commit(), timeoutPromise(6000, 'TIMEOUT_WRITE')]);
        } catch (e) {
          console.warn("Write batch timed out or failed, saving locally.", e);
          hasCloudError = true;
        }
      }
      
      localStorage.setItem('sadosa_db_seeded_v1', 'true');
      const sortedNewStudents = [...newStudentsList].sort((a, b) => {
        if (a.course !== b.course) {
          return a.course.localeCompare(b.course, 'es');
        }
        const orderA = a.order !== undefined ? a.order : 9999;
        const orderB = b.order !== undefined ? b.order : 9999;
        return orderA - orderB;
      });
      setStudents(sortedNewStudents);
      
      if (hasCloudError) {
        showToast(`¡Nómina Sincronizada Localmente! Se cargaron ${savedCount} estudiantes en su navegador (se detectaron problemas de conexión con la nube, pero sus datos ya están listos para usarse).`, 'success');
      } else {
        showToast(`¡Nómina Sincronizada! ${savedCount} estudiantes actualizados desde Google Sheets.`, 'success');
      }
    } catch (err: any) {
      console.error('Error in synchronization roster:', err);
      showToast(`Error de sincronización: ${err.message}`, 'error');
    } finally {
      setIsSyncingRoster(false);
    }
  };

  const exportAttendanceToGoogleSheets = async () => {
    if (!googleToken) {
      showToast('Debe conectar su cuenta de Google para exportar', 'error');
      return;
    }
    
    setIsExportingSheets(true);
    try {
      const spreadsheetId = '1XKbY1BReY-AhmUsxRAkDQHUS7PqfytAMD7RxEISF6jQ';
      const sheetName = 'SEC 2026';
      
      await ensureSheetExists(spreadsheetId, sheetName);
      
      showToast('Obteniendo todos los registros históricos guardados en la nube...', 'info');
      
      // Query ALL historical records straight from Firestore
      const attendanceCollection = collection(db, 'attendance');
      const querySnapshot = await getDocs(attendanceCollection);
      
      const freshAttendance: { [key: string]: { [studentId: string]: any } } = {};
      querySnapshot.forEach((docSnap) => {
        const item = docSnap.data();
        const date = item.date;
        const studentId = item.studentId;
        const period = item.period || 'P1';
        const key = `${date}__${period}`;
        
        if (date && studentId) {
          if (!freshAttendance[key]) {
            freshAttendance[key] = {};
          }
          freshAttendance[key][studentId] = {
            status: item.status || '',
            observation: item.observation || '',
            tags: item.tags || []
          };
        }
      });
      
      const rows: any[][] = [];
      rows.push([
        'Fecha',
        'Curso',
        'Periodo',
        'Estudiante (Apellidos y Nombres)',
        'Estado (A/R/L/F)',
        'Observaciones',
        'Etiquetas / Detalles',
        'Última Actualización'
      ]);
      
      Object.keys(freshAttendance).forEach(key => {
        const [date, period] = key.split('__');
        const studentsMap = freshAttendance[key];
        
        Object.keys(studentsMap).forEach(studentId => {
          const student = students.find(s => s.id === studentId);
          if (!student) return;
          const rec = studentsMap[studentId];
          if (!rec.status) return;
          
          rows.push([
            date,
            student.course,
            period,
            `${student.surname}, ${student.name}`,
            rec.status,
            rec.observation || '',
            (rec.tags || []).join(', '),
            new Date().toLocaleString('es-BO')
          ]);
        });
      });
      
      const dataRows = rows.slice(1);
      dataRows.sort((a, b) => {
        // Sort newest date first
        const dateCompare = b[0].localeCompare(a[0]);
        if (dateCompare !== 0) return dateCompare;
        
        const courseCompare = a[1].localeCompare(b[1]);
        if (courseCompare !== 0) return courseCompare;
        
        const periodCompare = a[2].localeCompare(b[2]);
        if (periodCompare !== 0) return periodCompare;
        
        return a[3].localeCompare(b[3]);
      });
      
      const finalValues = [rows[0], ...dataRows];
      
      showToast(`Exportando ${dataRows.length} registros a la hoja "SEC 2026"...`, 'info');
      
      // Clear a larger boundary (e.g. up to A1:H15000) to clean older spreadsheet entries fully
      await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/'${sheetName}'!A1:H15000:clear`, {
        method: 'POST',
        headers: { 
          Authorization: `Bearer ${googleToken}`,
          'Content-Type': 'application/json'
        }
      });
      
      const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/'${sheetName}'!A1?valueInputOption=USER_ENTERED`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${googleToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          values: finalValues
        })
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Google Sheets API respondió con error: ${errorText}`);
      }
      
      showToast(`¡Sincronización Completa! Se guardaron ${dataRows.length} registros históricos en Sheets (Hoja: SEC 2026).`, 'success');
    } catch (err: any) {
      console.error('Error exporting to Google Sheets:', err);
      showToast(`Error al exportar histórico: ${err.message}`, 'error');
    } finally {
      setIsExportingSheets(false);
    }
  };

  const isLicensedInPeriod = (studentId: string, p: string) => {
    const key = `${currentDate}__${p}`;
    return attendance[key]?.[studentId]?.status === 'L';
  };

  const toggleLicenseForPeriod = async (studentId: string, periodToToggle: string) => {
    const key = `${currentDate}__${periodToToggle}`;
    const rec = attendance[key]?.[studentId] || { status: '', observation: '', tags: [] };
    const newStatus: AttendanceStatus = rec.status === 'L' ? '' : 'L';
    const obs = rec.observation || 'Licencia';
    
    setAttendance(prev => {
      const pKey = `${currentDate}__${periodToToggle}`;
      const pRec = prev[pKey] || {};
      return {
        ...prev,
        [pKey]: {
          ...pRec,
          [studentId]: {
            ...rec,
            status: newStatus
          }
        }
      };
    });

    await saveAttendanceToFirestore(studentId, newStatus, obs, rec.tags, periodToToggle);
  };

  const applyLicenseToAllPeriods = async (studentId: string) => {
    const activeKey = `${currentDate}__${selectedPeriod}`;
    const currentRec = attendance[activeKey]?.[studentId] || { status: 'L', observation: 'Licencia', tags: [] };
    const obs = currentRec.observation || 'Licencia en todos los periodos';
    
    setAttendance(prev => {
      const updated = { ...prev };
      ['P1', 'P2', 'P3', 'P4'].forEach(p => {
        const pKey = `${currentDate}__${p}`;
        const pRec = updated[pKey] || {};
        updated[pKey] = {
          ...pRec,
          [studentId]: {
            status: 'L',
            observation: obs,
            tags: currentRec.tags
          }
        };
      });
      return updated;
    });

    for (const p of ['P1', 'P2', 'P3', 'P4']) {
      await saveAttendanceToFirestore(studentId, 'L', obs, currentRec.tags, p);
    }
    showToast('Licencia aplicada a todos los periodos (P1-P4)', 'success');
  };

  // --- ADD STUDENT WORKER ---
  const handleAddStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newStudentName.trim() || !newStudentSurname.trim()) {
      showToast('Por favor complete el nombre y apellido.', 'error');
      return;
    }

    const studentId = `st-${Date.now()}`;
    const newSt: Student = {
      id: studentId,
      name: newStudentName.trim(),
      surname: newStudentSurname.trim(),
      course: newStudentCourse,
      order: 9999
    };

    try {
      await setDoc(doc(db, 'students', studentId), {
        id: studentId,
        name: newSt.name,
        surname: newSt.surname,
        course: newSt.course,
        order: newSt.order,
        createdAt: new Date().toISOString()
      });
      setNewStudentName('');
      setNewStudentSurname('');
      showToast(`Estudiante "${newSt.surname}, ${newSt.name}" agregado en la nube exitosamente en el curso ${newSt.course}.`, 'success');
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `students/${studentId}`);
    }
  };

  // --- SYNC DATABASE WITH ALL 762 STUDENTS ---
  const handleResetDatabase = () => {
    setConfirmDialog({
      title: "Restablecer Base de Datos de Estudiantes",
      message: "¿Está seguro que desea RESTABLECER COMPLETAMENTE la base de datos de estudiantes?\n\nEsto cargará los 762 estudiantes oficiales de la Gestión Escolar 2026 organizados en sus 18 cursos (1RO A hasta 6TO C). Los registros históricos de asistencia se conservarán intactos.",
      confirmText: "Restablecer Todo",
      cancelText: "Cancelar",
      onConfirm: async () => {
        setConfirmDialog(null);
        setIsSeeding(true);
        setSeedProgress(1);

        try {
          const batchList: Student[][] = [];
          const size = 150; // split into chunks of 150 to reduce batch size and prevent payload limits
          for (let i = 0; i < DEFAULT_STUDENTS.length; i += size) {
            batchList.push(DEFAULT_STUDENTS.slice(i, i + size));
          }

          const timeoutPromise = (ms: number, errMsg = 'TIMEOUT') => new Promise((_, reject) => setTimeout(() => reject(new Error(errMsg)), ms));

          let count = 0;
          let hasCloudError = false;
          for (let b = 0; b < batchList.length; b++) {
            const batch = writeBatch(db);
            batchList[b].forEach((st) => {
              const orderVal = DEFAULT_STUDENTS.indexOf(st) + 1;
              batch.set(doc(db, 'students', st.id), {
                id: st.id,
                name: st.name,
                surname: st.surname,
                course: st.course,
                order: orderVal,
                createdAt: new Date().toISOString()
              });
              count++;
            });
            try {
              await Promise.race([batch.commit(), timeoutPromise(5000, 'TIMEOUT_WRITE_BATCH')]);
            } catch (error) {
              console.warn(`Seeding write batch ${b} timed out/failed. Fallback will trigger.`, error);
              hasCloudError = true;
            }
            setSeedProgress(Math.round((count / DEFAULT_STUDENTS.length) * 100));
          }
          
          localStorage.setItem('sadosa_db_seeded_v1', 'true');
          const defaultWithOrder = DEFAULT_STUDENTS.map((st, idx) => ({
            ...st,
            order: idx + 1
          }));
          setStudents(defaultWithOrder); // Sync local memory state so UI gets populated immediately
          
          if (hasCloudError) {
            showToast("¡Sincronización Completada! Los 762 alumnos se cargaron en su navegador para que pueda trabajar de inmediato. (Se guardó localmente debido a una respuesta lenta o desconexión temporal de la base de datos en tiempo real).", "success");
          } else {
            showToast(`¡Sincronización Exitosa! ${count} estudiantes cargados en los 18 cursos de Secundaria para la Gestión 2026.`, 'success');
          }
        } catch (error) {
          console.error(error);
          // Always fall back to local to make sure the user is never blocked
          localStorage.setItem('sadosa_db_seeded_v1', 'true');
          const defaultWithOrder = DEFAULT_STUDENTS.map((st, idx) => ({
            ...st,
            order: idx + 1
          }));
          setStudents(defaultWithOrder);
          showToast("Los 762 alumnos de la Gestión 2026 se han cargado localmente en su sesión.", "success");
        } finally {
          setIsSeeding(false);
          setSeedProgress(0);
        }
      }
    });
  };

  // --- REMOVE STUDENT WORKER ---
  const handleRemoveStudent = (id: string, name: string) => {
    setConfirmDialog({
      title: "Confirmar Baja de Estudiante",
      message: `¿Está seguro que desea dar de baja (eliminar de forma permanente) a: ${name}? Se perderán todos sus registros históricos de asistencia.`,
      confirmText: "Sí, Dar de Baja",
      cancelText: "Cancelar",
      onConfirm: async () => {
        setConfirmDialog(null);
        try {
          await deleteDoc(doc(db, 'students', id));
          showToast(`Estudiante ${name} ha sido dado de baja exitosamente.`, 'info');
        } catch (error) {
          handleFirestoreError(error, OperationType.DELETE, `students/${id}`);
        }
      }
    });
  };

  // --- COMPUTE STATISTICS FOR DATE RANGE ---
  const getDatesInRange = (startStr: string, endStr: string) => {
    const dates: string[] = [];
    if (!startStr || !endStr) return dates;
    
    const startParts = startStr.split('-');
    const endParts = endStr.split('-');
    if (startParts.length !== 3 || endParts.length !== 3) return dates;
    
    const current = new Date(Date.UTC(
      parseInt(startParts[0], 10),
      parseInt(startParts[1], 10) - 1,
      parseInt(startParts[2], 10)
    ));
    const end = new Date(Date.UTC(
      parseInt(endParts[0], 10),
      parseInt(endParts[1], 10) - 1,
      parseInt(endParts[2], 10)
    ));
    
    // Safety check to prevent infinite loops if dates are invalid
    let maxSteps = 400; // limit report to ~1 year
    while (current <= end && maxSteps > 0) {
      const year = current.getUTCFullYear();
      const month = String(current.getUTCMonth() + 1).padStart(2, '0');
      const day = String(current.getUTCDate()).padStart(2, '0');
      dates.push(`${year}-${month}-${day}`);
      current.setUTCDate(current.getUTCDate() + 1);
      maxSteps--;
    }
    return dates;
  };

  const reportDates = getDatesInRange(reportStartDate, reportEndDate);

  const getStudentStats = (studentId: string) => {
    let A = 0, R = 0, L = 0, F = 0, unchecked = 0;
    const obsList: { date: string; text: string; tags: string[] }[] = [];

    reportDates.forEach(d => {
      if (reportPeriodFilter === 'Todos') {
        ['P1', 'P2', 'P3', 'P4'].forEach(p => {
          const key = `${d}__${p}`;
          const dayRec = attendance[key]?.[studentId];
          if (dayRec) {
            if (dayRec.status === 'A') A++;
            else if (dayRec.status === 'R') R++;
            else if (dayRec.status === 'L') L++;
            else if (dayRec.status === 'F') F++;
            else unchecked++;

            if (dayRec.observation.trim() || dayRec.tags.length > 0) {
              obsList.push({
                date: `${d} (${p})`,
                text: dayRec.observation.trim(),
                tags: dayRec.tags
              });
            }
          } else {
            unchecked++;
          }
        });
      } else {
        const key = `${d}__${reportPeriodFilter}`;
        const dayRec = attendance[key]?.[studentId];
        if (dayRec) {
          if (dayRec.status === 'A') A++;
          else if (dayRec.status === 'R') R++;
          else if (dayRec.status === 'L') L++;
          else if (dayRec.status === 'F') F++;
          else unchecked++;

          if (dayRec.observation.trim() || dayRec.tags.length > 0) {
            obsList.push({
              date: d,
              text: dayRec.observation.trim(),
              tags: dayRec.tags
            });
          }
        } else {
          unchecked++;
        }
      }
    });

    const totalDays = A + R + L + F;
    const asistenciaPercent = totalDays > 0 ? Math.round(((A + R + L) / totalDays) * 100) : 100;

    return { A, R, L, F, unchecked, totalDays, asistenciaPercent, obsList };
  };

  // Overall database range info
  let totalPresentAcrossAll = 0;
  let totalLateAcrossAll = 0;
  let totalLicensesAcrossAll = 0;
  let totalAbsencesAcrossAll = 0;

  const filteredStudentsForStats = reportCourseFilter === 'Todos'
    ? students
    : students.filter(st => st.course === reportCourseFilter);

  filteredStudentsForStats.forEach(st => {
    const s = getStudentStats(st.id);
    totalPresentAcrossAll += s.A;
    totalLateAcrossAll += s.R;
    totalLicensesAcrossAll += s.L;
    totalAbsencesAcrossAll += s.F;
  });

  const grandTotalElements = totalPresentAcrossAll + totalLateAcrossAll + totalLicensesAcrossAll + totalAbsencesAcrossAll;
  const averageAttendanceRate = grandTotalElements > 0 
    ? Math.round(((totalPresentAcrossAll + totalLateAcrossAll + totalLicensesAcrossAll) / grandTotalElements) * 100)
    : 100;

  // --- PDF GENERATOR VIA JSPDF ---
  const generatePDFReport = () => {
    const doc = new jsPDF({
      orientation: 'p',
      unit: 'mm',
      format: 'a4'
    });
    
    // Page count tracker
    let currentPageNum = 1;
    
    // Helper tool to draw header standard
    const drawPageHeader = () => {
      // Main boundary border outline
      doc.setDrawColor(203, 213, 225); // slate 300
      doc.setLineWidth(0.3);
      doc.rect(8, 8, 194, 281);
      
      // Header logo background (or nice clean text header)
      doc.setFont('Helvetica', 'bold');
      doc.setFontSize(14);
      doc.setTextColor(15, 23, 42); // slate 900
      doc.text('UNIDAD EDUCATIVA SANTO DOMINGO SAVIO', 105, 16, { align: 'center' });
      
      doc.setFont('Helvetica', 'normal');
      doc.setFontSize(10);
      doc.setTextColor(71, 85, 105); // slate 600
      doc.text('Registro Oficial de Control Escolar de Asistencia - Nivel Secundario', 105, 21, { align: 'center' });
      const periodLabel = reportPeriodFilter === 'Todos' ? 'Todos los Periodos (Combinado)' : reportPeriodFilter;
      doc.text(`Gestión Escolar 2026 | Rango: ${reportStartDate} al ${reportEndDate} | Curso: ${reportCourseFilter} | Periodo: ${periodLabel}`, 105, 26, { align: 'center' });
      
      // Divider line
      doc.setDrawColor(30, 41, 59); // slate 800
      doc.setLineWidth(0.5);
      doc.line(12, 29, 198, 29);
    };

    drawPageHeader();

    // Table Header
    let y = 37;
    doc.setFont('Helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(30, 41, 59);
    doc.text('#', 13, y);
    doc.text('APELLIDOS Y NOMBRES', 19, y);
    doc.text('A', 110, y, { align: 'center' });
    doc.text('R', 120, y, { align: 'center' });
    doc.text('L', 130, y, { align: 'center' });
    doc.text('F', 140, y, { align: 'center' });
    doc.text('% Asist.', 152, y, { align: 'center' });
    doc.text('OBSERVACIONES DESTACADAS / TAGS', 162, y);

    // Header Underscore line
    doc.setDrawColor(71, 85, 105);
    doc.setLineWidth(0.3);
    doc.line(12, y + 2, 198, y + 2);
    
    // Reset font
    doc.setFont('Helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(51, 65, 85); // slate 700

    y += 6;

    // Filter students based on reporting query and selected course filter
    const filteredReportStudents = students.filter(st => {
      const fullName = `${st.surname} ${st.name}`.toLowerCase();
      const matchSearch = fullName.includes(reportSearchQuery.toLowerCase());
      const matchCourse = reportCourseFilter === 'Todos' || st.course === reportCourseFilter;
      return matchSearch && matchCourse;
    });

    filteredReportStudents.forEach((st, idx) => {
      const stats = getStudentStats(st.id);
      
      // Check for page overflow
      if (y > 265) {
        // Footer for previous page
        doc.setFontSize(7);
        doc.setTextColor(148, 163, 184); // slate 400
        doc.text(`Generado el: ${new Date().toLocaleDateString('es-ES')} | Página ${currentPageNum}`, 105, 285, { align: 'center' });
        
        doc.addPage();
        currentPageNum++;
        drawPageHeader();
        
        // Re-write headers
        y = 37;
        doc.setFont('Helvetica', 'bold');
        doc.setFontSize(9);
        doc.setTextColor(30, 41, 59);
        doc.text('#', 13, y);
        doc.text('APELLIDOS Y NOMBRES', 19, y);
        doc.text('A', 110, y, { align: 'center' });
        doc.text('R', 120, y, { align: 'center' });
        doc.text('L', 130, y, { align: 'center' });
        doc.text('F', 140, y, { align: 'center' });
        doc.text('% Asist.', 152, y, { align: 'center' });
        doc.text('OBSERVACIONES DESTACADAS / TAGS', 162, y);
        
        doc.setDrawColor(71, 85, 105);
        doc.setLineWidth(0.3);
        doc.line(12, y + 2, 198, y + 2);
        
        doc.setFont('Helvetica', 'normal');
        doc.setFontSize(8);
        doc.setTextColor(51, 65, 85);
        y += 6;
      }

      const fullnameString = `${st.surname}, ${st.name}`;
      
      doc.text(String(idx + 1), 13, y);
      doc.text(fullnameString.substring(0, 50), 19, y);
      
      // Numbers centering
      doc.text(String(stats.A), 110, y, { align: 'center' });
      doc.text(String(stats.R), 120, y, { align: 'center' });
      doc.text(String(stats.L), 130, y, { align: 'center' });
      doc.text(String(stats.F), 140, y, { align: 'center' });
      doc.text(`${stats.asistenciaPercent}%`, 152, y, { align: 'center' });

      // Gather top observations
      const consolidatedObs: string[] = [];
      stats.obsList.forEach(rawObs => {
        if (rawObs.tags.length > 0) {
          consolidatedObs.push(...rawObs.tags);
        }
        if (rawObs.text.trim()) {
          consolidatedObs.push(rawObs.text.trim());
        }
      });

      // Clear layout and join observer strings
      const obsDisplayText = consolidatedObs.length > 0 
        ? Array.from(new Set(consolidatedObs)).join('; ')
        : 'Sin observaciones de relevancia';
      
      // Cut off if too long
      doc.text(obsDisplayText.substring(0, 48), 162, y);

      // Light underline per row
      doc.setDrawColor(241, 245, 249); // slate 100
      doc.setLineWidth(0.15);
      doc.line(12, y + 1.5, 198, y + 1.5);

      y += 5.5;
    });

    // Signatures and end summary block
    if (y > 230) {
      // Footer page previous
      doc.setFontSize(7);
      doc.setTextColor(148, 163, 184);
      doc.text(`Generado el: ${new Date().toLocaleDateString('es-ES')} | Página ${currentPageNum}`, 105, 285, { align: 'center' });

      doc.addPage();
      currentPageNum++;
      drawPageHeader();
      y = 40;
    }

    // Statistics Box at bottom of content
    y += 5;
    doc.setDrawColor(226, 232, 240); // slate 200
    doc.setFillColor(248, 250, 252); // slate 50
    doc.rect(12, y, 186, 24, 'FD');
    
    doc.setFont('Helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(30, 41, 59);
    doc.text('RESUMEN DE ASISTENCIA GLOBAL DE LA CLASE EN EL RANGO', 16, y + 5);
    
    doc.setFont('Helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.text(`Promedio Asistencia General: ${averageAttendanceRate}%`, 16, y + 11);
    doc.text(`Total Alumnos Registrados: ${students.length}`, 16, y + 17);
    
    doc.text(`Totales acumulados clase:`, 110, y + 11);
    doc.text(`Asistencias (A): ${totalPresentAcrossAll}  |  Retrasos (R): ${totalLateAcrossAll}`, 110, y + 16);
    doc.text(`Licencias (L): ${totalLicensesAcrossAll}  |  Faltas (F): ${totalAbsencesAcrossAll}`, 110, y + 20);

    // Signatures section at bottom of document
    y += 40;
    doc.setDrawColor(100, 116, 139); // slate 500
    doc.setLineWidth(0.4);
    
    // Line 1
    doc.line(25, y, 90, y);
    doc.setFont('Helvetica', 'bold');
    doc.setFontSize(9);
    doc.text('Firma del Asesor de Curso', 57, y + 4, { align: 'center' });
    doc.setFont('Helvetica', 'normal');
    doc.setFontSize(8);
    doc.text('Unidad Educativa Santo Domingo Savio', 57, y + 8, { align: 'center' });

    // Line 2
    doc.line(120, y, 185, y);
    doc.setFont('Helvetica', 'bold');
    doc.setFontSize(9);
    doc.text('Firma del Director de Secundaria', 152, y + 4, { align: 'center' });
    doc.setFont('Helvetica', 'normal');
    doc.setFontSize(8);
    doc.text('Sello y Firma Autorizada', 152, y + 8, { align: 'center' });

    // Global document final footer
    doc.setFontSize(7);
    doc.setTextColor(148, 163, 184);
    doc.text(`Generado el: ${new Date().toLocaleDateString('es-ES')} | Página ${currentPageNum} | San Pedro, Bolivia`, 105, 285, { align: 'center' });

    // Download triggered
    const filename = `Reporte_Asistencia_SDS_Secundaria_${reportStartDate}_a_${reportEndDate}.pdf`;
    doc.save(filename);
    showToast(`PDF generado y descargado como ${filename}`, 'success');
  };

  // --- SHORTCUT NAVIGATION BUTTONS TO SHIFT CURRENT DATE ---
  const handleShiftDate = (days: number) => {
    const current = new Date(currentDate);
    current.setDate(current.getDate() + days);
    const year = current.getFullYear();
    const month = String(current.getMonth() + 1).padStart(2, '0');
    const day = String(current.getDate()).padStart(2, '0');
    setCurrentDate(`${year}-${month}-${day}`);
  };

  // --- RENDER SCREEN ACCORDING TO AUTH ---
  if (!isAuthorized) {
    return (
      <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col justify-between p-4 sm:p-8 relative overflow-hidden font-sans selection:bg-slate-700 selection:text-yellow-400">
        
        {/* Decorative Grid and Ambient Lights */}
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_var(--tw-gradient-stops))] from-slate-800/40 via-slate-900 to-slate-950 pointer-events-none z-0" />
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-7xl h-[400px] bg-yellow-500/5 rounded-full blur-[120px] pointer-events-none z-0" />

        {/* Top Header / Bar */}
        <header className="relative z-10 flex items-center justify-between max-w-6xl w-full mx-auto border-b border-slate-800 pb-5 pt-2">
          <div className="flex items-center gap-3">
            <div className="bg-yellow-500/10 p-2 rounded-xl border border-yellow-500/20">
              <GraduationCap className="h-6 w-6 text-yellow-400" />
            </div>
            <div>
              <span className="font-extrabold text-sm uppercase tracking-wider text-white">SADOSA 2026</span>
              <p className="text-[10px] text-slate-400 tracking-wider font-mono">SECUNDARIA PARTICULAR</p>
            </div>
          </div>
          <div className="hidden sm:flex items-center gap-2 bg-slate-800/40 px-3.5 py-1.5 rounded-full border border-slate-800 text-xs font-mono text-slate-300">
            <span className="inline-block w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
            <span>Base de Datos Online</span>
          </div>
        </header>

        {/* Main Landing Hero Content */}
        <main className="relative z-10 max-w-5xl w-full mx-auto flex flex-col items-center justify-center py-12 text-center my-auto">
          
          <div className="bg-yellow-500/10 text-yellow-400 text-xs font-semibold px-4 py-1.5 rounded-full border border-yellow-400/20 uppercase tracking-widest font-mono mb-6 animate-pulse">
            Bolivia • Gestión Escolar 2026
          </div>

          <h1 className="text-3xl sm:text-5xl lg:text-6xl font-black tracking-tight text-white leading-tight max-w-4xl">
            Control de Asistencia <span className="text-yellow-400 block sm:inline">Santo Domingo Savio</span>
          </h1>

          <p className="mt-5 text-sm sm:text-base text-slate-300 max-w-2xl leading-relaxed">
            Plataforma digital para el registro diario, ausencias, atrasos y licencias del alumnado de nivel secundario. Sincronización inmediata con base de datos, descargas de reportes e histórico continuo.
          </p>

          {/* Action Button - Pulses and Glows beautifully */}
          <div className="mt-10 relative group">
            <div className="absolute -inset-1.5 bg-gradient-to-r from-yellow-500 to-amber-600 rounded-2xl blur opacity-30 group-hover:opacity-60 transition duration-300" />
            <button
              onClick={() => {
                setAuthError(null);
                setEnteredPassword('');
                setIsLoginModalOpen(true);
              }}
              className="relative w-full sm:w-auto bg-gradient-to-r from-yellow-400 to-amber-500 hover:from-yellow-300 hover:to-amber-400 text-slate-950 px-8 py-4.5 rounded-2xl font-bold text-sm tracking-wide shadow-2xl hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center gap-3 cursor-pointer"
            >
              <Lock className="h-4.5 w-4.5 text-slate-950 shrink-0" />
              <span>Ingresar al Control de Asistencia</span>
            </button>
          </div>

          {/* Institutional Stats Grid */}
          <div className="mt-16 grid grid-cols-1 sm:grid-cols-3 gap-4 w-full max-w-4xl text-left">
            <div className="bg-slate-900/50 p-5 rounded-2xl border border-slate-800/60 backdrop-blur-xs">
              <span className="text-[10px] uppercase font-mono tracking-widest text-yellow-400 font-bold">Matrícula General</span>
              <p className="text-3xl font-black text-white mt-1">762</p>
              <p className="text-xs text-slate-400 mt-1 leading-snug">Estudiantes registrados de forma oficial en el plantel.</p>
            </div>
            
            <div className="bg-slate-900/50 p-5 rounded-2xl border border-slate-800/60 backdrop-blur-xs">
              <span className="text-[10px] uppercase font-mono tracking-widest text-yellow-400 font-bold">Unidades de Curso</span>
              <p className="text-3xl font-black text-white mt-1">18 Cursos</p>
              <p className="text-xs text-slate-400 mt-1 leading-snug">Organizados desde 1ro A hasta 6to C de Secundaria.</p>
            </div>

            <div className="bg-slate-900/50 p-5 rounded-2xl border border-slate-800/60 backdrop-blur-xs bg-[radial-gradient(ellipse_at_bottom_right,_var(--tw-gradient-stops))] from-amber-500/5 via-transparent to-transparent">
              <span className="text-[10px] uppercase font-mono tracking-widest text-yellow-400 font-bold">Monitoreo Integrado</span>
              <p className="text-3xl font-black text-white mt-1">100%</p>
              <p className="text-xs text-slate-400 mt-1 leading-snug">Consultas, reportes consolidados y estadísticas instantáneas.</p>
            </div>
          </div>

        </main>

        {/* Footer info */}
        <footer className="relative z-10 flex flex-col sm:flex-row items-center justify-between max-w-6xl w-full mx-auto border-t border-slate-800/80 pt-6 pb-2 text-center sm:text-left gap-4">
          <span className="text-[11px] text-slate-500 uppercase tracking-widest font-mono">
            Unidad Educativa Santo Domingo Savio • San Pedro, Bolivia
          </span>
          <span className="text-[11px] text-slate-500 uppercase tracking-widest font-mono">
            Gestión Académica Secundaria 2026
          </span>
        </footer>

        {/* =======================================================
            LOGIN POPUP WINDOW (VENTANA DE INGRESO)
            ======================================================= */}
        {isLoginModalOpen && (
          <div 
            id="login-modal-window" 
            className="fixed inset-0 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4 z-50 animate-in fade-in duration-300"
          >
            <div 
              className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden transform animate-in zoom-in-95 duration-200 text-slate-800"
              onClick={(e) => e.stopPropagation()}
            >
              
              {/* Modal Window Header */}
              <div className="bg-slate-950 px-6 py-5 text-white flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="bg-yellow-400/10 p-1.5 rounded-lg border border-yellow-400/20">
                    <Lock className="h-4.5 w-4.5 text-yellow-400" />
                  </div>
                  <div>
                    <span className="font-extrabold text-xs uppercase tracking-wider text-white">CONEXIÓN INSTITUCIONAL</span>
                    <p className="text-[9px] text-slate-300 tracking-wider uppercase font-mono">Validación Requerida</p>
                  </div>
                </div>
                <button 
                  type="button" 
                  onClick={() => setIsLoginModalOpen(false)}
                  className="text-slate-400 hover:text-white transition cursor-pointer"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              {/* Modal Form Body */}
              <form onSubmit={handleLoginSubmit} className="p-6 sm:p-8 space-y-6">
                
                <div className="text-center space-y-1.5">
                  <h2 className="text-lg font-extrabold text-slate-900">Ingreso al Sistema</h2>
                  <p className="text-xs text-slate-500 leading-relaxed">
                    Ingrese la clave de acceso institucional universal (<strong>sadosa2026</strong>) para habilitar el control de asistencia.
                  </p>
                </div>

                {authError && (
                  <div id="auth-error-alert" className="bg-rose-50 text-rose-700 p-3.5 rounded-xl text-xs flex items-center gap-3 border border-rose-100 animate-pulse">
                    <AlertCircle className="h-4.5 w-4.5 shrink-0 text-rose-600" />
                    <span className="font-medium">{authError}</span>
                  </div>
                )}

                <div className="space-y-2">
                  <label htmlFor="auth-password" className="text-xs font-semibold text-slate-700 uppercase tracking-wider block">
                    Clave de Acceso
                  </label>
                  <div className="relative">
                    <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center text-slate-400">
                      <Lock className="h-4 w-4 text-slate-400" />
                    </span>
                    <input
                      id="auth-password"
                      type={showPassword ? "text" : "password"}
                      className="w-full pl-10 pr-12 py-3 bg-slate-50 border border-slate-300 rounded-xl font-mono text-center tracking-widest focus:bg-white focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent transition-all text-xs"
                      placeholder="••••••••••••"
                      value={enteredPassword}
                      onChange={(e) => setEnteredPassword(e.target.value)}
                      required
                      autoFocus
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-400 hover:text-slate-600 transition cursor-pointer"
                    >
                      {showPassword ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                </div>

                <div className="flex gap-2.5 pt-1">
                  <button
                    type="button"
                    onClick={() => setIsLoginModalOpen(false)}
                    className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold py-3.5 rounded-xl text-xs transition border border-slate-200 cursor-pointer"
                  >
                    Cancelar
                  </button>
                  <button
                    id="submit-auth-button"
                    type="submit"
                    className="flex-1 bg-slate-900 hover:bg-slate-800 text-white font-bold py-3.5 rounded-xl text-xs transition-all flex items-center justify-center gap-2 shadow-md cursor-pointer"
                  >
                    <Unlock className="h-3.5 w-3.5 text-slate-300" />
                    <span>Iniciar Sesión</span>
                  </button>
                </div>

              </form>

            </div>
          </div>
        )}

      </div>
    );
  }

  // --- STATS CALCULATION FOR CURRENT COURSE AND SELECTED DATE & PERIOD ---
  const activeKey = `${currentDate}__${selectedPeriod}`;
  const courseStudents = students.filter(st => st.course === selectedCourse);
  let countA = 0;
  let countR = 0;
  let countL = 0;
  let countF = 0;
  let countSinRegistrar = 0;

  courseStudents.forEach(st => {
    const status = attendance[activeKey]?.[st.id]?.status || '';
    if (status === 'A') countA++;
    else if (status === 'R') countR++;
    else if (status === 'L') countL++;
    else if (status === 'F') countF++;
    else countSinRegistrar++;
  });

  const totalAsistentesReal = countA + countR;

  // --- LOADED & AUTHORIZED DASHBOARD ---
  return (
    <div className="min-h-screen bg-slate-50 pb-16 font-sans relative">
      {/* Toast Notification */}
      {toastMessage && (
        <div 
          id="toast-notification"
          className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 px-5 py-4 rounded-xl shadow-xl border max-w-md transition-all duration-300 transform translate-y-0 scale-100 ${
            toastMessage.type === 'success' 
              ? 'bg-emerald-50 text-emerald-850 border-emerald-200' 
              : toastMessage.type === 'error'
              ? 'bg-rose-50 text-rose-850 border-rose-200'
              : 'bg-slate-800 text-white border-slate-700'
          }`}
        >
          {toastMessage.type === 'success' && <CheckCircle className="h-5 w-5 text-emerald-500 shrink-0" />}
          {toastMessage.type === 'error' && <AlertCircle className="h-5 w-5 text-rose-500 shrink-0" />}
          {toastMessage.type === 'info' && <Info className="h-5 w-5 text-sky-400 shrink-0" />}
          
          <div className="text-xs font-medium">{toastMessage.text}</div>
          <button 
            type="button" 
            onClick={() => setToastMessage(null)}
            className="text-slate-400 hover:text-slate-600 ml-auto"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* INSTITUTION HEADER COMPONENT */}
      <header className="bg-slate-900 text-white shadow-md select-none no-print">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between py-6 gap-4">
            <div className="flex items-center gap-4">
              <div className="bg-slate-800 p-3 rounded-2xl ring-2 ring-yellow-400/20">
                <GraduationCap className="h-7 w-7 text-yellow-400" />
              </div>
              <div>
                <h1 className="text-lg md:text-xl font-black tracking-tight text-yellow-400">CONTROL DE ASISTENCIA SADOSA SECUNDARIA PARTICULAR 2026</h1>
                <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 mt-0.5 text-xs text-slate-300">
                  <span className="font-semibold text-white">Unidad Educativa Santo Domingo Savio</span>
                  <span>•</span>
                  <span className="font-mono text-slate-300">Gestión Escolar 2026</span>
                  <span>•</span>
                  <span className="bg-slate-800 px-2.5 py-0.5 rounded text-[10px] text-slate-300 uppercase tracking-widest border border-slate-700">Bolivia</span>
                </div>
                {/* INDICADOR DE TIEMPO REAL COOPERATIVO */}
                <div className="mt-2 flex items-center gap-1.5 bg-slate-850 px-2.5 py-1 rounded-lg border border-emerald-500/25 w-fit">
                  <span className="relative flex h-2 w-2 shrink-0">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                  </span>
                  <span className="text-[9.5px] font-bold text-emerald-400 tracking-wider font-mono uppercase">
                    Base de Datos en Tiempo Real Sincronizada (Modo Cooperativo Activo)
                  </span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3 self-end md:self-center">
              <div className="text-right hidden sm:block">
                <div className="text-xs text-slate-400">Operador Autorizado</div>
                <div className="text-xs font-semibold text-slate-200">Asesor de Nivel</div>
              </div>
              <button
                id="logout-btn"
                type="button"
                onClick={handleLogout}
                className="bg-slate-800 hover:bg-slate-700/80 hover:text-rose-400 text-slate-300 px-3.5 py-2.5 rounded-xl text-xs font-medium flex items-center gap-2 border border-slate-700 transition"
                title="Cerrar la sesión de asistencia"
              >
                <LogOut className="h-4 w-4" />
                <span className="hidden sm:inline">Cerrar Sesión</span>
              </button>
            </div>
          </div>
        </div>

        {/* INNER NAVIGATION TAB BAR */}
        <div className="border-t border-slate-850">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex space-x-1.5 py-2">
              <button
                id="tab-diario"
                onClick={() => { setActiveTab('diario'); setSpeechError(null); }}
                className={`px-4 py-2.5 rounded-xl text-xs font-semibold tracking-wide transition-all uppercase ${
                  activeTab === 'diario'
                    ? 'bg-yellow-400 text-slate-950 font-bold shadow-md shadow-yellow-400/10'
                    : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                }`}
              >
                Control Diario
              </button>

              <button
                id="tab-estudiantes"
                onClick={() => { 
                  if (isAdminAuthorized) {
                    setActiveTab('estudiantes');
                  } else {
                    setShowAdminLockModal(true);
                  }
                }}
                className={`px-4 py-2.5 rounded-xl text-xs font-semibold tracking-wide transition-all uppercase flex items-center gap-1.5 ${
                  activeTab === 'estudiantes'
                    ? 'bg-yellow-400 text-slate-950 font-bold shadow-md shadow-yellow-400/10'
                    : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                }`}
              >
                {!isAdminAuthorized ? <Lock className="h-3.5 w-3.5 text-slate-400" /> : <Unlock className="h-3.5 w-3.5 text-slate-950" />}
                Alumnos
              </button>

              <button
                id="tab-reportes"
                onClick={() => { setActiveTab('reportes'); setSpeechError(null); }}
                className={`px-4 py-2.5 rounded-xl text-xs font-semibold tracking-wide transition-all uppercase ${
                  activeTab === 'reportes'
                    ? 'bg-yellow-400 text-slate-950 font-bold shadow-md shadow-yellow-400/10'
                    : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                }`}
              >
                Reportes por Fecha
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* REAL ACADEMIC WORKSPACE */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6 select-none">
        
        {/* TAB 1: CONTROL DIARIO */}
        {activeTab === 'diario' && (
          <div id="view-control-diario" className="space-y-6">
            
            {/* CURSO SELECTOR (LISTA DESPLEGABLE AZUL) */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 sm:p-5">
              <div className="relative w-full">
                <select
                  id="main-course-dropdown-selector"
                  value={selectedCourse}
                  onChange={(e) => {
                    const course = e.target.value;
                    setSelectedCourse(course);
                    setNewStudentCourse(course); // Keep in sync for bulk/individual additions
                  }}
                  className="w-full appearance-none bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-extrabold px-6 py-4 pr-12 text-sm rounded-xl border border-blue-700 shadow-md ring-4 ring-blue-500/15 focus:outline-none focus:ring-blue-500/35 transition-all cursor-pointer text-center"
                >
                  {COURSES.map((course) => {
                    const count = students.filter(st => st.course === course).length;
                    return (
                      <option key={course} value={course} className="bg-slate-900 text-white font-bold py-2 text-xs text-left">
                        {course} ({count} alumnos registrados)
                      </option>
                    );
                  })}
                </select>
                <div className="absolute inset-y-0 right-0 flex items-center pr-4 pointer-events-none text-white">
                  <ChevronDown className="h-5 w-5" />
                </div>
              </div>
            </div>

            {/* COLLAPSIBLE DASHBOARD INDEX: ACCORDION COMPONENT TO AVOID WEB VIEW CONGESTION */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden transition-all duration-300">
              <button
                type="button"
                onClick={() => setControlPanelExpanded(!controlPanelExpanded)}
                className="w-full px-4 py-3 bg-slate-900 text-white flex items-center justify-between gap-3 text-left hover:bg-slate-850 transition cursor-pointer select-none"
              >
                <div className="flex items-center gap-2">
                  <div className={`p-1.5 rounded-lg border transition-all shrink-0 ${controlPanelExpanded ? 'bg-yellow-400 text-slate-950 border-yellow-400 font-extrabold' : 'bg-slate-800 text-white border-slate-705 font-medium'}`}>
                    <SlidersHorizontal className="h-4 w-4" />
                  </div>
                </div>
                
                <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
                  {/* Mini preview tags to show actual status always! */}
                  <div className="flex flex-wrap items-center gap-1 text-[10px]">
                    <span className="bg-slate-800 border border-slate-700 text-slate-300 px-2 py-0.5 rounded font-bold font-mono whitespace-nowrap">{currentDate}</span>
                    <span className="bg-yellow-400 text-slate-950 px-2 py-0.5 rounded font-black font-mono">{selectedPeriod}</span>
                    <span className="bg-emerald-500 text-white px-2 py-0.5 rounded font-bold font-mono">A:{countA}</span>
                    <span className="bg-amber-400 text-slate-950 px-2 py-0.5 rounded font-black font-mono">R:{countR}</span>
                    <span className="bg-sky-500 text-white px-2 py-0.5 rounded font-bold font-mono">L:{countL}</span>
                    <span className="bg-rose-500 text-white px-2 py-0.5 rounded font-bold font-mono">F:{countF}</span>
                  </div>
                  <div className="h-7 w-7 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-400 shrink-0">
                    <ChevronDown className={`h-4 w-4 transition-transform duration-300 ${controlPanelExpanded ? 'rotate-180' : ''}`} />
                  </div>
                </div>
              </button>
              
              {controlPanelExpanded && (
                <div className="border-t border-slate-200 p-4 sm:p-5 bg-slate-50 space-y-5 animate-in slide-in-from-top-2 duration-200">
                  
                  {/* 1. DATE SELECTOR & PERIOD SELECTOR (SIDE-BY-SIDE OR GRID RANGE) */}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    {/* Period Selector (Left / Top) */}
                    <div className="bg-slate-900 rounded-2xl border border-slate-950 p-4 shadow-md relative overflow-hidden flex flex-col justify-between">
                      <div className="absolute top-0 right-0 h-40 w-40 bg-yellow-400/5 rounded-full blur-2xl pointer-events-none"></div>
                      <div className="flex items-center gap-3 mb-3">
                        <div className="bg-slate-800 p-2 rounded-xl text-yellow-400 border border-slate-700/50">
                          <Clock className="h-4.5 w-4.5" />
                        </div>
                        <div>
                          <h4 className="font-extrabold text-white text-xs uppercase tracking-wide">PERIODO DE CONTROL EN CURSO</h4>
                          <p className="text-[9.5px] text-slate-400 mt-0.5">Periodo asignado para el control diario</p>
                        </div>
                      </div>

                      <div className="grid grid-cols-4 bg-slate-800 p-1 rounded-xl border border-slate-700 w-full">
                        {['P1', 'P2', 'P3', 'P4'].map((p) => {
                          const label = p === 'P1' ? '1er Periodo' : p === 'P2' ? '2do Periodo' : p === 'P3' ? '3er Periodo' : '4to Periodo';
                          const isActive = selectedPeriod === p;
                          return (
                            <button
                              key={p}
                              type="button"
                              onClick={() => {
                                setSelectedPeriod(p);
                                showToast(`Cambiado al ${label} (${p}) con éxito`, 'info');
                              }}
                              className={`py-1.5 rounded-lg text-xs font-black tracking-wide transition-all uppercase text-all text-center flex flex-col items-center justify-center cursor-pointer ${
                                isActive
                                  ? 'bg-yellow-400 text-slate-950 font-black shadow-md shadow-yellow-400/25'
                                  : 'text-slate-400 hover:text-white hover:bg-slate-700/50'
                              }`}
                            >
                              <span className="text-sm font-mono font-black">{p}</span>
                              <span className="text-[7.5px] font-bold opacity-90 mt-0.5 hidden sm:inline">{label}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Date Selector (Right / Bottom) */}
                    <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm flex flex-col justify-between">
                      <div className="flex items-center gap-3 mb-3">
                        <div className="bg-slate-100 p-2 rounded-xl text-slate-800 border border-slate-200">
                          <Calendar className="h-4.5 w-4.5 text-slate-600" />
                        </div>
                        <div>
                          <h4 className="font-extrabold text-slate-900 text-xs uppercase tracking-wide">FECHA DEL REGISTRO</h4>
                          <p className="text-[9.5px] text-slate-400 mt-0.5">Ajuste la fecha para revisar o ingresar datos históricos</p>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 w-full">
                        <button
                          type="button"
                          onClick={() => handleShiftDate(-1)}
                          className="p-2.5 bg-slate-50 border border-slate-200 rounded-lg hover:bg-slate-100 text-slate-600 transition cursor-pointer"
                          title="Día Anterior"
                        >
                          <ChevronLeft className="h-4 w-4" />
                        </button>
                        
                        <input
                          id="date-selector"
                          type="date"
                          className="flex-1 bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-900 text-center cursor-pointer"
                          value={currentDate}
                          onChange={(e) => setCurrentDate(e.target.value)}
                        />

                        <button
                          type="button"
                          onClick={() => handleShiftDate(1)}
                          className="p-2.5 bg-slate-50 border border-slate-200 rounded-lg hover:bg-slate-100 text-slate-600 transition cursor-pointer"
                          title="Día Siguiente"
                        >
                          <ChevronRight className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* 2. COMPACT REAL-TIME STATS ROW (RESUMEN) */}
                  <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs">
                    <h4 className="font-extrabold text-slate-900 text-[11px] uppercase tracking-wider text-slate-400 mb-3 font-mono">RESUMEN DE ASISTENCIA ACTUAL ({selectedCourse})</h4>
                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
                      <div className="bg-slate-100 text-slate-808 p-2.5 rounded-xl font-bold flex flex-col justify-center items-center border border-slate-200">
                        <span className="text-[8.5px] font-bold text-slate-500 uppercase">MATRÍCULA:</span>
                        <span className="font-mono font-black text-lg mt-0.5">{courseStudents.length}</span>
                      </div>
                      <div className="bg-emerald-50 text-emerald-850 p-2.5 rounded-xl font-bold flex flex-col justify-center items-center border border-emerald-100">
                        <span className="text-[8.5px] font-bold text-emerald-600 uppercase">ASISTENCIAS (A):</span>
                        <span className="font-mono font-black text-lg text-emerald-700 mt-0.5">{countA}</span>
                      </div>
                      <div className="bg-amber-50 text-amber-850 p-2.5 rounded-xl font-bold flex flex-col justify-center items-center border border-amber-100">
                        <span className="text-[8.5px] font-bold text-amber-600 uppercase">RETRASOS (R):</span>
                        <span className="font-mono font-black text-lg text-amber-700 mt-0.5">{countR}</span>
                      </div>
                      <div className="bg-sky-50 text-sky-850 p-2.5 rounded-xl font-bold flex flex-col justify-center items-center border border-sky-100">
                        <span className="text-[8.5px] font-bold text-sky-600 uppercase">LICENCIAS (L):</span>
                        <span className="font-mono font-black text-lg text-sky-700 mt-0.5">{countL}</span>
                      </div>
                      <div className="bg-rose-50 text-rose-850 p-2.5 rounded-xl font-bold flex flex-col justify-center items-center border border-rose-100 col-span-2 sm:col-span-1">
                        <span className="text-[8.5px] font-bold text-rose-600 uppercase">FALTAS (F):</span>
                        <span className="font-mono font-black text-lg text-rose-700 mt-0.5">{countF}</span>
                      </div>
                    </div>

                    <div className="mt-4 pt-4 border-t border-slate-150 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50 -mx-4 -mb-4 p-4 rounded-b-2xl">
                      <div className="bg-slate-900 border border-slate-950 rounded-xl px-3.5 py-1.5 flex flex-col items-center justify-center min-w-[130px] shadow-sm">
                        <span className="text-[8px] font-extrabold text-amber-400 uppercase tracking-widest text-center">ASISTENTES (A+R)</span>
                        <span className="text-xs font-black text-white font-mono mt-0.5">{totalAsistentesReal} <span className="text-[9px] font-normal text-slate-300">alumnos</span></span>
                      </div>

                      <button
                        id="btn-bulk-attendance"
                        type="button"
                        onClick={handleMassAttendance}
                        className="bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white rounded-xl px-4 py-2 text-xs font-black transition-all flex items-center justify-center gap-1.5 shadow-md shadow-emerald-500/10 border-b-2 border-emerald-800 cursor-pointer select-none"
                      >
                        <CheckCircle className="h-4 w-4 shrink-0 text-white" />
                        <span>Llamado de Asistencia Masiva</span>
                      </button>
                    </div>
                  </div>

                  {/* 4. SPEECH MICROPHONE MANUAL & GUIDELINE DATA */}
                  <div className="bg-slate-900 text-amber-300 rounded-2xl p-4 border border-slate-950 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-sm">
                    <div className="flex items-center gap-3">
                      <div className="bg-slate-800 p-2 rounded-xl text-amber-400 shrink-0">
                        <Mic className="h-4.5 w-4.5" />
                      </div>
                      <div className="space-y-0.5">
                        <h5 className="font-extrabold text-[11px] uppercase tracking-wide text-white">Guía de Dictación Rápida por Voz</h5>
                        <p className="text-[10px] text-slate-300">Tenga el micrófono activo y pronuncie palabras clave del estudiante para marcar:</p>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 text-[9.5px]">
                      <span className="bg-emerald-500/25 border border-emerald-500/30 text-emerald-300 px-2.5 py-1 rounded font-bold">"Presente" o "Asiste" (A)</span>
                      <span className="bg-amber-400/25 border border-amber-450/30 text-amber-300 px-2.5 py-1 rounded font-bold">"Retraso" o "Tarde" (R)</span>
                      <span className="bg-sky-500/25 border border-sky-500/30 text-sky-300 px-2.5 py-1 rounded font-bold">"Licencia" o "Permiso" (L)</span>
                      <span className="bg-rose-500/25 border border-rose-500/30 text-rose-300 px-2.5 py-1 rounded font-bold">"Falta" o "Faltó" (F)</span>
                    </div>
                  </div>

                </div>
              )}
            </div>
            
            {/* ACCESO RÁPIDO LLAMADO DE ASISTENCIA MASIVA */}
            <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 flex flex-col md:flex-row items-center justify-between gap-4 shadow-sm">
              {/* Selector de periodos P1 - P4 */}
              <div className="flex items-center gap-3 w-full md:w-auto">
                <span className="text-[11px] font-black text-emerald-850 uppercase tracking-wider shrink-0 font-sans">
                  PERIODO:
                </span>
                <div className="grid grid-cols-4 bg-emerald-100/60 p-1 rounded-xl border border-emerald-200/60 w-full md:w-64">
                  {['P1', 'P2', 'P3', 'P4'].map((p) => {
                    const label = p === 'P1' ? '1er Periodo' : p === 'P2' ? '2do Periodo' : p === 'P3' ? '3er Periodo' : '4to Periodo';
                    const isActive = selectedPeriod === p;
                    return (
                      <button
                        key={p}
                        type="button"
                        onClick={() => {
                          setSelectedPeriod(p);
                          showToast(`Cambiado al ${label} (${p}) con éxito`, 'info');
                        }}
                        className={`py-1.5 rounded-lg text-xs font-black tracking-wide transition-all uppercase text-center flex flex-col items-center justify-center cursor-pointer ${
                          isActive
                            ? 'bg-emerald-600 text-white font-black shadow-md shadow-emerald-600/25'
                            : 'text-emerald-700 hover:text-emerald-900 hover:bg-emerald-200/40'
                        }`}
                      >
                        <span className="text-xs font-mono font-black">{p}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Botón de Ejecutar Llamado Masivo */}
              <button
                id="btn-main-bulk-attendance"
                type="button"
                onClick={handleMassAttendance}
                className="w-full md:w-auto bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white font-extrabold text-xs px-5 py-3 rounded-xl flex items-center justify-center gap-2 border-b-2 border-emerald-800 shadow-md shadow-emerald-500/10 cursor-pointer select-none transition-all shrink-0"
              >
                <CheckCircle className="h-4 w-4 text-white shrink-0" />
                <span>Ejecutar Llamado Masivo ({selectedPeriod})</span>
              </button>
            </div>

            {/* ALUMNOS GRID WORKSPACE */}
            <div id="student-attendance-workspace" className="space-y-3">
              {students.filter(st => st.course === selectedCourse).length === 0 ? (
                <div className="bg-white border border-slate-200 rounded-2xl p-12 text-center text-slate-500 space-y-4">
                  <UserPlus className="h-12 w-12 text-slate-300 mx-auto" />
                  <div>
                    <h3 className="text-base font-bold text-slate-800">No hay estudiantes en el curso {selectedCourse}</h3>
                    <p className="text-xs text-slate-400 mt-1">Haga clic en el menú "Alumnos" o sincronice la base de datos completo.</p>
                  </div>
                </div>
              ) : (
                students.filter(st => st.course === selectedCourse).map((student, index) => {
                  const studentAttendance = attendance[activeKey]?.[student.id] || { status: '', observation: '', tags: [] };
                  const isListening = listeningStudentId === student.id;

                  return (
                    <div 
                      key={student.id} 
                      className="bg-white rounded-2xl border border-slate-200 hover:border-slate-300 p-3.5 sm:p-4 shadow-xs transition-all flex flex-col gap-3.5"
                    >
                      {/* Top line on mobile: holds student name + index AND the cycle bubble side-by-side! on md/lg, sits as flex row items-center */}
                      <div className="flex flex-row items-center justify-between md:justify-start gap-4 w-full">
                        
                        {/* Left Block: Index, student name */}
                        <div className="flex items-center gap-3 min-w-0 flex-1 md:flex-initial md:min-w-[280px]">
                          <span className="h-7 w-7 rounded-lg bg-slate-100 text-slate-500 font-mono text-center flex items-center justify-center text-xs font-bold shrink-0">
                            {String(index + 1).padStart(2, '0')}
                          </span>
                          <div className="min-w-0 truncate">
                            <h4 className="font-bold text-slate-900 leading-tight text-[14px] truncate">
                              {student.surname}
                            </h4>
                            <p className="text-xs font-semibold text-slate-400 truncate">{student.name}</p>
                          </div>
                        </div>

                        {/* Middle Block: UNIFIED STATE BUBBLE INTERFACE (Tap to Cycle) */}
                        <div className="flex items-center gap-3 shrink-0">
                          <button
                            type="button"
                            onClick={() => cycleAttendance(student.id)}
                            className={`h-11 w-11 sm:h-12 sm:w-12 rounded-full font-black text-xs sm:text-sm flex items-center justify-center transition-all transform hover:scale-[1.05] active:scale-95 cursor-pointer shadow-sm select-none border-2 border-transparent shrink-0 ${
                              studentAttendance.status === 'A'
                                ? 'bg-emerald-500 text-white shadow-md shadow-emerald-500/35 ring-2 ring-emerald-600'
                                : studentAttendance.status === 'R'
                                ? 'bg-amber-400 text-slate-900 shadow-md shadow-amber-400/35 ring-2 ring-amber-500'
                                : studentAttendance.status === 'L'
                                ? 'bg-sky-500 text-white shadow-md shadow-sky-500/35 ring-2 ring-sky-600'
                                : studentAttendance.status === 'F'
                                ? 'bg-rose-500 text-white shadow-md shadow-rose-500/35 ring-2 ring-rose-600'
                                : 'bg-white border-2 border-dashed border-slate-300 text-slate-400 hover:border-slate-400 hover:bg-slate-50'
                            }`}
                            title="Tocar para alternar"
                          >
                            {studentAttendance.status || '•'}
                          </button>
                          
                          <div className="hidden lg:flex flex-col text-[10px] text-slate-400 leading-tight shrink-0">
                            <span className={`${studentAttendance.status === 'A' ? 'text-emerald-600 font-bold' : ''}`}>A: Asistencia</span>
                            <span className={`${studentAttendance.status === 'R' ? 'text-amber-550 font-bold' : ''}`}>R: Retraso</span>
                            <span className={`${studentAttendance.status === 'L' ? 'text-sky-600 font-bold' : ''}`}>L: Licencia</span>
                            <span className={`${studentAttendance.status === 'F' ? 'text-rose-600 font-bold' : ''}`}>F: Falta</span>
                          </div>
                        </div>

                        {/* Desktop-only separator & right observation block */}
                        <div className="hidden md:block h-8 w-px bg-slate-250 shrink-0"></div>
                        <div className="hidden md:block flex-1">
                          <StudentObservationInput 
                            studentId={student.id}
                            value={studentAttendance.observation}
                            onSave={handleObservationChange}
                            isListening={isListening}
                            onVoiceToggle={() => handleVoiceToggle(student.id)}
                          />
                        </div>

                      </div>

                      {/* Mobile-only observation block at the bottom */}
                      <div className="block md:hidden w-full">
                        <StudentObservationInput 
                          studentId={student.id}
                          value={studentAttendance.observation}
                          onSave={handleObservationChange}
                          isListening={isListening}
                          onVoiceToggle={() => handleVoiceToggle(student.id)}
                        />
                      </div>

                      {/* Period License Switcher (Only visible when Attendance status is L) */}
                      {studentAttendance.status === 'L' && (
                        <div className="bg-sky-50 border border-sky-100 rounded-xl p-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 animate-in fade-in duration-200">
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="h-2 w-2 rounded-full bg-sky-500 animate-pulse"></span>
                            <span className="text-[10px] font-extrabold text-sky-800 uppercase tracking-wide">Periodos de Licencia L:</span>
                          </div>
                          <div className="flex flex-wrap items-center gap-1">
                            {['P1', 'P2', 'P3', 'P4'].map((p) => {
                              const isLicensed = isLicensedInPeriod(student.id, p);
                              return (
                                <button
                                  type="button"
                                  key={p}
                                  onClick={() => toggleLicenseForPeriod(student.id, p)}
                                  className={`px-2 py-1 text-[9.5px] font-black font-mono rounded-lg transition-all border cursor-pointer select-none shrink-0 ${
                                    isLicensed
                                      ? 'bg-sky-500 text-white border-sky-600 shadow-sm'
                                      : 'bg-white text-slate-500 border-slate-205 hover:bg-sky-100 hover:text-sky-700'
                                  }`}
                                  title={`Alternar Licencia para el periodo ${p}`}
                                >
                                  {p}
                                </button>
                              );
                            })}
                            <button
                              type="button"
                              onClick={() => applyLicenseToAllPeriods(student.id)}
                              className="px-2 py-1 text-[9.5px] font-black rounded-lg bg-sky-100 text-sky-800 border border-sky-200 hover:bg-sky-200 transition-all cursor-pointer select-none shrink-0 ml-1"
                            >
                              P1 - P4 (Todos)
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            {/* SPEECH HELPER INFO AREA */}
            <div className="bg-slate-100 p-4.5 rounded-2xl flex items-start gap-3.5 border border-slate-200">
              <Info className="h-5 w-5 text-slate-400 mt-0.5 shrink-0" />
              <div className="text-[12px] text-slate-600 space-y-1">
                <span className="font-bold text-slate-800 block uppercase">Manual de Control Santo Domingo Savio</span>
                <p>Haga clic una vez sobre la burbuja central para asignar estados rápidamente. Los estados se almacenarán en su navegador de forma persistente para la fecha escogida. El reconocimiento de voz funciona en navegadores compatibles pidiendo permiso para usar su micrófono en español.</p>
              </div>
            </div>

          </div>
        )}

        {/* TAB 2: GESTION DE ESTUDIANTES (PROTECTED BY PASSCODE "2026") */}
        {activeTab === 'estudiantes' && isAdminAuthorized && (
          <div id="view-student-management" className="space-y-6">
            
            {/* ADD STUDENT CARD */}
            <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
              <div className="border-b border-slate-150 pb-4 mb-5 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <UserPlus className="h-5 w-5 text-slate-800" />
                  <h3 className="font-bold text-slate-900 uppercase text-sm">Registrar Nuevo Alumno</h3>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setIsAdminAuthorized(false);
                    setActiveTab('diario');
                    showToast('Sección de administración bloqueada de nuevo', 'info');
                  }}
                  className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold px-2.5 py-1.5 rounded-lg border border-slate-200 transition"
                >
                  Bloquear Modo Admin
                </button>
              </div>

              <form onSubmit={handleAddStudent} className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
                <div className="space-y-1">
                  <label htmlFor="student-surname" className="text-xs font-bold text-slate-500 uppercase">Apellidos del Alumno</label>
                  <input
                    id="student-surname"
                    type="text"
                    required
                    placeholder="Ej. Perez Siles"
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3.5 py-2.5 text-xs text-slate-850 font-medium focus:bg-white focus:outline-none focus:ring-1 focus:ring-slate-800"
                    value={newStudentSurname}
                    onChange={(e) => setNewStudentSurname(e.target.value)}
                  />
                </div>

                <div className="space-y-1">
                  <label htmlFor="student-name" className="text-xs font-bold text-slate-500 uppercase">Nombres del Alumno</label>
                  <input
                    id="student-name"
                    type="text"
                    required
                    placeholder="Ej. Marcelo Gabriel"
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3.5 py-2.5 text-xs text-slate-850 font-medium focus:bg-white focus:outline-none focus:ring-1 focus:ring-slate-800"
                    value={newStudentName}
                    onChange={(e) => setNewStudentName(e.target.value)}
                  />
                </div>

                <div className="space-y-1">
                  <label htmlFor="student-course-select" className="text-xs font-bold text-slate-500 uppercase">Curso de Secundaria</label>
                  <select
                    id="student-course-select"
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3.5 py-2.5 text-xs text-slate-850 font-bold focus:bg-white focus:outline-none focus:ring-1 focus:ring-slate-800"
                    value={newStudentCourse}
                    onChange={(e) => setNewStudentCourse(e.target.value)}
                  >
                    {COURSES.map(course => (
                      <option key={course} value={course}>{course}</option>
                    ))}
                  </select>
                </div>

                <button
                  id="btn-add-student"
                  type="submit"
                  className="bg-slate-900 border-b-2 border-slate-950 hover:bg-slate-800 text-white rounded-xl py-3 text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer shadow-sm select-none"
                >
                  <Plus className="h-4.5 w-4.5" />
                  <span>Dar de Alta Estudiante</span>
                </button>
              </form>

              {/* CLOUD DB RE-SYNC COMPONENT FOR SECUNDARIA 2026 */}
              <div className="mt-6 pt-6 border-t border-slate-100 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <div className="max-w-xl">
                  <h4 className="text-xs font-bold text-slate-900 uppercase">Sincronización de Gestión Escolar 2026</h4>
                  <p className="text-[11px] text-slate-500 mt-1">
                    Cargue automáticamente los 762 estudiantes oficiales del nivel secundario distribuidos en sus respectivos cursos en la nube.
                  </p>
                </div>
                
                {isSeeding ? (
                  <div className="w-full md:max-w-xs space-y-2">
                    <div className="flex justify-between text-xs font-mono font-bold text-slate-700">
                      <span>Sincronizando estudiantes...</span>
                      <span>{seedProgress}%</span>
                    </div>
                    <div className="w-full bg-slate-100 rounded-full h-2">
                      <div className="bg-slate-900 h-2 rounded-full transition-all duration-300" style={{ width: `${seedProgress}%` }}></div>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={handleResetDatabase}
                    className="bg-amber-400 hover:bg-amber-500 text-slate-950 font-extrabold px-5 py-3 text-xs rounded-xl border border-amber-500 shadow-sm flex items-center justify-center gap-2 cursor-pointer shrink-0 transition"
                  >
                    <Download className="h-4 w-4 text-slate-900" />
                    <span>Cargar 762 Estudiantes Oficiales 2026</span>
                  </button>
                )}
              </div>
            </div>

            {/* ADMINISTRATOR GOOGLE SHEETS CLOUD INTEGRATION */}
            <div className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 shadow-sm space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-150 pb-4">
                <div className="flex items-center gap-2.5">
                  <div className="bg-emerald-50 p-2 rounded-xl border border-emerald-200 text-emerald-750 shrink-0">
                    <FileSpreadsheet className="h-5 w-5 text-emerald-600" />
                  </div>
                  <div>
                    <h4 className="font-extrabold text-slate-900 text-sm uppercase tracking-wide flex items-center gap-2">
                      <span>INTEGRACIÓN ADMINISTRATIVA DE GOOGLE SHEETS SADOSA 2026</span>
                      <span className="bg-indigo-100 text-indigo-800 text-[8.5px] px-1.5 py-0.5 rounded font-black border border-indigo-200 uppercase">ADMIN ONLY</span>
                    </h4>
                    <p className="text-[11px] text-slate-500 mt-1">Sincronice la nómina de alumnos y respalde el historial de asistencia en la nube de Google Sheets.</p>
                  </div>
                </div>

                <div className="shrink-0">
                  {!googleToken ? (
                    <button
                      type="button"
                      onClick={handleGoogleSignIn}
                      className="bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 hover:border-slate-400 shadow-xs font-bold rounded-xl px-4 py-2.5 text-xs flex items-center gap-2 transition cursor-pointer select-none"
                    >
                      <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" width="24" height="24" xmlns="http://www.w3.org/2000/svg">
                        <g transform="matrix(1, 0, 0, 1, 0, 0)">
                          <path d="M21.35,11.1H12v2.7h5.38c-0.24,1.28 -0.96,2.37 -2.04,3.1v2.56h3.3c1.93,-1.78 3.04,-4.4 3.04,-7.4C21.68,11.72 21.56,11.39 21.35,11.1z" fill="#4285F4" />
                          <path d="M12,20.9c2.43,0 4.47,-0.8 5.96,-2.2l-3.3,-2.56c-0.91,0.61 -2.08,0.98 -3.3,0.98c-2.31,0 -4.27,-1.56 -4.97,-3.66H1.97v2.64C3.46,19.06 7.42,20.9 12,20.9z" fill="#34A853" />
                          <path d="M7.03,13.46c-0.18,-0.54 -0.28,-1.11 -0.28,-1.7s0.1,-1.16 0.28,-1.7V7.42H1.97C1.3,8.76 0.92,10.28 0.92,11.9s0.38,3.14 1.05,4.48L7.03,13.46z" fill="#FBBC05" />
                          <path d="M12,6.86c1.32,0 2.51,0.45 3.44,1.35l2.58,-2.58C16.46,4.09 14.43,3.1 12,3.1C7.42,3.1 3.46,4.94 1.97,7.42l5.06,3.64C7.73,8.96 9.69,6.86 12,6.86z" fill="#EA4335" />
                        </g>
                      </svg>
                      <span>Conectar Cuenta Google Admin</span>
                    </button>
                  ) : (
                    <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 px-3 py-2 rounded-xl font-medium">
                      <div className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse shrink-0"></div>
                      <span className="text-[11px] text-emerald-950 font-black max-w-[150px] truncate">{googleUser?.displayName || 'Admin Conectado'}</span>
                      <button
                        type="button"
                        onClick={handleGoogleSignOut}
                        className="text-slate-500 hover:text-slate-800 text-[11px] font-bold border-l pl-2 border-emerald-200 cursor-pointer"
                      >
                        Salir
                      </button>
                    </div>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                {/* Left: Input student roster */}
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3.5">
                  <div className="space-y-1">
                    <h5 className="text-[12px] font-black text-slate-900 uppercase tracking-wide font-sans">A: Importar Nómina del Colegio</h5>
                    <p className="text-[10px] text-slate-500 leading-relaxed font-sans">Enlace y sincronice la nómina de alumnos. Se actualizará automáticamente en la base de datos de esta plataforma.</p>
                    <a
                      href="https://docs.google.com/spreadsheets/d/1AMDubHoRNA1Hr2_XQcudyGZUYB0cP6IqcsOxfA85_oI/edit?usp=sharing"
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 text-[11px] text-indigo-600 font-bold hover:underline"
                    >
                      <span>Planilla de Alumnos Origen ↗</span>
                    </a>
                  </div>

                  <button
                    type="button"
                    disabled={!googleToken || isSyncingRoster}
                    onClick={syncRosterFromGoogleSheets}
                    className={`w-full py-3 rounded-xl font-extrabold text-xs flex items-center justify-center gap-2 transition border cursor-pointer select-none ${
                      !googleToken 
                        ? 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed'
                        : 'bg-indigo-600 text-white border-indigo-700 shadow-sm hover:bg-indigo-700'
                    }`}
                  >
                    {isSyncingRoster ? (
                      <>
                        <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        <span>Importando Alumnos...</span>
                      </>
                    ) : (
                      <>
                        <ArrowDownCircle className="h-4.5 w-4.5 shrink-0" />
                        <span>Sincronizar Alumnos desde Google Sheets</span>
                      </>
                    )}
                  </button>
                </div>

                {/* Right: Export attendance history */}
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3.5">
                  <div className="space-y-1">
                    <h5 className="text-[12px] font-black text-slate-900 uppercase tracking-wide font-sans">B: Respaldar Historial Asistencia</h5>
                    <p className="text-[10px] text-slate-500 leading-relaxed font-sans">Guarde o actualice de forma persistente los reportes históricos de asistencia en el servidor remoto.</p>
                    <a
                      href="https://docs.google.com/spreadsheets/d/1XKbY1BReY-AhmUsxRAkDQHUS7PqfytAMD7RxEISF6jQ/edit?usp=sharing"
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 text-[11px] text-green-600 font-bold hover:underline"
                    >
                      <span>Planilla de Reportes Hoja SEC 2026 ↗</span>
                    </a>
                  </div>

                  <button
                    type="button"
                    disabled={!googleToken || isExportingSheets}
                    onClick={exportAttendanceToGoogleSheets}
                    className={`w-full py-3 rounded-xl font-extrabold text-xs flex items-center justify-center gap-2 transition border cursor-pointer select-none ${
                      !googleToken 
                        ? 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed'
                        : 'bg-green-600 text-white border-green-700 shadow-sm hover:bg-green-700'
                    }`}
                  >
                    {isExportingSheets ? (
                      <>
                        <svg className="animate-spin h-3.5 w-3.5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        <span>Exportando Historial...</span>
                      </>
                    ) : (
                      <>
                        <ArrowUpCircle className="h-4.5 w-4.5 shrink-0" />
                        <span>Sincronizar y Exportar Históricos</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>

            {/* CURRENT LIST EXCLUSIONS */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="px-5 py-4 bg-slate-50 border-b border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <BookOpen className="h-5 w-5 text-slate-700" />
                  <h4 className="font-bold text-slate-900 uppercase text-xs tracking-wider">Estudiantes de la Unidad Educativa</h4>
                </div>

                {/* Micro search filter */}
                <div className="relative w-full sm:max-w-xs">
                  <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-400">
                    <Search className="h-3.5 w-3.5" />
                  </span>
                  <input
                    type="text"
                    placeholder="Filtrar estudiante por nombre/apellido..."
                    className="w-full bg-white border border-slate-300 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-slate-950"
                    value={mgmtSearch}
                    onChange={(e) => setMgmtSearch(e.target.value)}
                  />
                </div>
              </div>

              {/* TABLE CONTAINER */}
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-100 text-slate-400 font-bold uppercase tracking-wider font-mono">
                      <th className="px-5 py-3 w-16">#</th>
                      <th className="px-5 py-3">Apellidos del Estudiante</th>
                      <th className="px-5 py-3">Nombres del Estudiante</th>
                      <th className="px-5 py-3">Curso</th>
                      <th className="px-5 py-3 text-center w-32">Acción</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-medium">
                    {students
                      .filter(st => {
                        const searchStr = `${st.surname} ${st.name}`.toLowerCase();
                        return searchStr.includes(mgmtSearch.toLowerCase());
                      })
                      .map((student, idx) => (
                        <tr key={student.id} className="hover:bg-slate-50 transition-colors">
                          <td className="px-5 py-3 font-mono text-slate-400 font-semibold">{idx + 1}</td>
                          <td className="px-5 py-3 text-slate-850 font-bold">{student.surname}</td>
                          <td className="px-5 py-3 text-slate-700">{student.name}</td>
                          <td className="px-5 py-3">
                            <span className="bg-slate-100 border border-slate-200 text-slate-800 text-[10.5px] font-bold px-2 py-0.5 rounded-md">
                              {student.course}
                            </span>
                          </td>
                          <td className="px-5 py-3 text-center">
                            <button
                              type="button"
                              onClick={() => handleRemoveStudent(student.id, `${student.surname}, ${student.name}`)}
                              className="text-slate-400 hover:text-rose-600 p-1.5 rounded-lg hover:bg-rose-50 transition flex items-center gap-1.5 mx-auto text-xs"
                              title="Eliminar de forma permanente"
                            >
                              <Trash2 className="h-4 w-4 shrink-0" />
                              <span className="text-[11px] font-bold">Dar de baja</span>
                            </button>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>

            </div>

          </div>
        )}

        {/* TAB 3: REPORTES Y DESCARGA PDF */}
        {activeTab === 'reportes' && (
          <div id="view-reports" className="space-y-6">
            
            {/* RANGE CONF CONFIG */}
            <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4">
              <div className="border-b border-slate-150 pb-3 flex flex-col sm:flex-row items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <FileText className="h-5 w-5 text-slate-950" />
                  <h3 className="font-bold text-slate-900 uppercase text-[13px] tracking-wide">Configuración del Reporte Médico-Académico</h3>
                </div>
                
                {/* PDF TRIGGER BUTTON */}
                <button
                  id="btn-download-pdf"
                  onClick={generatePDFReport}
                  className="bg-slate-900 border-b-2 border-slate-950 text-white font-bold px-4 py-2 text-xs rounded-xl hover:bg-slate-800 transition flex items-center justify-center gap-2 cursor-pointer shadow-md shadow-slate-900/10 no-print"
                >
                  <Download className="h-4.5 w-4.5 text-yellow-500" />
                  <span>Generar y Descargar PDF Oficial</span>
                </button>
              </div>

              {/* inputs flex rows */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
                
                <div className="space-y-1">
                  <label htmlFor="report-start" className="text-[10px] font-bold text-slate-500 uppercase">Fecha de Inicio del Reporte</label>
                  <input
                    id="report-start"
                    type="date"
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-semibold text-slate-800"
                    value={reportStartDate}
                    onChange={(e) => setReportStartDate(e.target.value)}
                  />
                </div>

                <div className="space-y-1">
                  <label htmlFor="report-end" className="text-[10px] font-bold text-slate-500 uppercase">Fecha de Cierre del Reporte</label>
                  <input
                    id="report-end"
                    type="date"
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-semibold text-slate-800"
                    value={reportEndDate}
                    onChange={(e) => setReportEndDate(e.target.value)}
                  />
                </div>

                <div className="space-y-1">
                  <label htmlFor="report-course" className="text-[10px] font-bold text-slate-500 uppercase">Filtrar por Curso en Reporte</label>
                  <select
                    id="report-course"
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold text-slate-800 focus:bg-white focus:outline-none focus:ring-1 focus:ring-slate-800"
                    value={reportCourseFilter}
                    onChange={(e) => setReportCourseFilter(e.target.value)}
                  >
                    <option value="Todos">[ Todos los cursos (762 alumnos) ]</option>
                    {COURSES.map(course => (
                      <option key={course} value={course}>{course}</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <label htmlFor="report-period-filter" className="text-[10px] font-bold text-slate-500 uppercase">Filtrar por Periodo</label>
                  <select
                    id="report-period-filter"
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold text-slate-800 focus:bg-white focus:outline-none focus:ring-1 focus:ring-slate-800"
                    value={reportPeriodFilter}
                    onChange={(e) => setReportPeriodFilter(e.target.value)}
                  >
                    <option value="Todos">Todos (P1+P2+P3+P4)</option>
                    <option value="P1">P1 (Primer Periodo)</option>
                    <option value="P2">P2 (Segundo Periodo)</option>
                    <option value="P3">P3 (Tercer Periodo)</option>
                    <option value="P4">P4 (Cuarto Periodo)</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label htmlFor="query-report" className="text-[10px] font-bold text-slate-500 uppercase">Filtrar por Estudiante en Reporte</label>
                  <div className="relative">
                    <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-400">
                      <Search className="h-3.5 w-3.5" />
                    </span>
                    <input
                      id="query-report"
                      type="text"
                      placeholder="Ej. Quispe Mamani"
                      className="w-full bg-slate-50 border border-slate-300 rounded-xl pl-9 pr-3 py-2 text-xs text-slate-800 placeholder-slate-400 focus:bg-white focus:outline-none focus:ring-1 focus:ring-slate-800"
                      value={reportSearchQuery}
                      onChange={(e) => setReportSearchQuery(e.target.value)}
                    />
                  </div>
                </div>

              </div>

              {/* STATS PREVIEW CARDS */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
                
                <div className="bg-emerald-50 rounded-xl p-3 border border-emerald-100 flex items-center gap-3">
                  <div className="bg-emerald-500 text-white rounded-lg h-8 w-8 font-black text-xs flex items-center justify-center shrink-0">A</div>
                  <div>
                    <span className="text-[9.5px] font-bold text-emerald-800 uppercase block">Presentes (A)</span>
                    <span className="text-sm font-black text-emerald-950 font-mono">{totalPresentAcrossAll}</span>
                  </div>
                </div>

                <div className="bg-amber-50 rounded-xl p-3 border border-amber-100 flex items-center gap-3">
                  <div className="bg-amber-400 text-slate-900 rounded-lg h-8 w-8 font-black text-xs flex items-center justify-center shrink-0">R</div>
                  <div>
                    <span className="text-[9.5px] font-bold text-amber-800 uppercase block">Retrasos (R)</span>
                    <span className="text-sm font-black text-amber-950 font-mono">{totalLateAcrossAll}</span>
                  </div>
                </div>

                <div className="bg-sky-50 rounded-xl p-3 border border-sky-100 flex items-center gap-3">
                  <div className="bg-sky-500 text-white rounded-lg h-8 w-8 font-black text-xs flex items-center justify-center shrink-0">L</div>
                  <div>
                    <span className="text-[9.5px] font-bold text-sky-800 uppercase block">Licencias (L)</span>
                    <span className="text-sm font-black text-sky-950 font-mono">{totalLicensesAcrossAll}</span>
                  </div>
                </div>

                <div className="bg-rose-50 rounded-xl p-3 border border-rose-100 flex items-center gap-3">
                  <div className="bg-rose-500 text-white rounded-lg h-8 w-8 font-black text-xs flex items-center justify-center shrink-0">F</div>
                  <div>
                    <span className="text-[9.5px] font-bold text-rose-800 uppercase block">Faltas (F)</span>
                    <span className="text-sm font-black text-rose-950 font-mono">{totalAbsencesAcrossAll}</span>
                  </div>
                </div>

              </div>

            </div>

            {/* PREVIEW LEDGER MATRIZ GRID */}
            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
              <div className="px-5 py-4 bg-slate-950 text-white flex items-center justify-between">
                <div>
                  <h4 className="font-bold text-xs uppercase tracking-wider font-mono">Consolidado General de Asistencia y Disciplina</h4>
                  <p className="text-[10px] text-slate-400 mt-0.5">Vista previa interactiva del libro de registro - {reportDates.length} días calendario evaluados</p>
                </div>
                
                <span className="bg-yellow-400 text-slate-950 text-[10.5px] font-bold px-2.5 py-1 rounded-full uppercase tracking-widest leading-none font-mono">
                  Promedio: {averageAttendanceRate}%
                </span>
              </div>

              {/* TABLE GRID */}
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-slate-500 font-bold uppercase tracking-wider font-mono text-[10.5px]">
                      <th className="px-5 py-3.5 w-12 text-center">Nro</th>
                      <th className="px-5 py-3.5 min-w-[200px]">Apellidos y Nombres</th>
                      <th className="px-4 py-3.5 text-center bg-emerald-50/50 w-16 text-emerald-800">A</th>
                      <th className="px-4 py-3.5 text-center bg-amber-50/50 w-16 text-amber-800">R</th>
                      <th className="px-4 py-3.5 text-center bg-sky-50/50 w-16 text-sky-800">L</th>
                      <th className="px-4 py-3.5 text-center bg-rose-50/50 w-16 text-rose-800">F</th>
                      <th className="px-5 py-3.5 text-center w-24">Tasa Asist.</th>
                      <th className="px-5 py-3.5">Observaciones Totales Registradas en el Rango</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-medium">
                    {students
                      .filter(st => {
                        const fullName = `${st.surname} ${st.name}`.toLowerCase();
                        const matchSearch = fullName.includes(reportSearchQuery.toLowerCase());
                        const matchCourse = reportCourseFilter === 'Todos' || st.course === reportCourseFilter;
                        return matchSearch && matchCourse;
                      })
                      .map((student, idx) => {
                        const s = getStudentStats(student.id);
                        
                        // Check if student has attendance rate below threshold or high absences (just a alert helper)
                        const alertRow = s.F >= 3;

                        return (
                          <tr key={student.id} className={`hover:bg-slate-50 transition-colors ${alertRow ? 'bg-rose-50/20' : ''}`}>
                            <td className="px-5 py-3 font-mono text-slate-400 text-center">{idx + 1}</td>
                            <td className="px-5 py-3">
                              <span className="font-bold text-slate-900 text-xs block">{student.surname}</span>
                              <span className="text-[10.5px] font-semibold text-slate-400">{student.name}</span>
                            </td>
                            
                            <td className="px-4 py-3 bg-emerald-50/20 font-mono text-center font-bold text-emerald-700">{s.A}</td>
                            <td className="px-4 py-3 bg-amber-50/20 font-mono text-center font-bold text-amber-600">{s.R}</td>
                            <td className="px-4 py-3 bg-sky-50/20 font-mono text-center font-bold text-sky-600">{s.L}</td>
                            <td className="px-4 py-3 bg-rose-50/20 font-mono text-center font-bold text-rose-600">{s.F}</td>
                            
                            <td className="px-5 py-3 text-center">
                              <span className={`px-2 py-1 rounded text-xs font-bold font-mono ${
                                s.asistenciaPercent >= 90
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : s.asistenciaPercent >= 75
                                  ? 'bg-amber-100 text-amber-800'
                                  : 'bg-rose-100 text-rose-800'
                              }`}>
                                {s.asistenciaPercent}%
                              </span>
                            </td>

                            <td className="px-5 py-3 space-y-1 text-[11px] max-w-sm">
                              {s.obsList.length === 0 ? (
                                <span className="text-slate-400 italic">No hay notas o observaciones registradas.</span>
                              ) : (
                                <div className="space-y-1.5 max-h-24 overflow-y-auto pr-1">
                                  {s.obsList.map((o, io) => (
                                    <div key={io} className="bg-slate-50 border border-slate-150 p-1.5 rounded-lg">
                                      <div className="flex items-center justify-between text-[10px] text-slate-400 font-mono font-bold">
                                        <span>Fecha: {o.date}</span>
                                      </div>
                                      
                                      {o.tags.length > 0 && (
                                        <div className="flex flex-wrap gap-1 mt-1 mb-0.5">
                                          {o.tags.map((tg, itg) => (
                                            <span key={itg} className="bg-yellow-100 text-yellow-900 border border-yellow-200 text-[9px] font-bold px-1.5 py-0.2 rounded uppercase">
                                              {tg}
                                            </span>
                                          ))}
                                        </div>
                                      )}

                                      {o.text.trim() && (
                                        <p className="text-slate-600 italic leading-snug font-medium mt-0.5">
                                          "{o.text.trim()}"
                                        </p>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>

            </div>

          </div>
        )}

      </main>

      {/* ADMIN CODE RE-LOCK INTERSTITIAL DIALOG MODAL */}
      {showAdminLockModal && (
        <div id="admin-passcode-modal" className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden transform animate-in fade-in zoom-in-95 duration-200">
            <div className="bg-slate-900 px-6 py-5 text-white flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <ShieldAlert className="h-5 w-5 text-yellow-400 shrink-0" />
                <span className="font-bold text-sm uppercase tracking-wide">Área Restringida - Clave Requerida</span>
              </div>
              <button 
                type="button" 
                onClick={() => { setShowAdminLockModal(false); setAdminPassword(''); setAdminError(null); }}
                className="text-slate-400 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleAdminVerify} className="p-6 space-y-5">
              <p className="text-xs text-slate-500 leading-relaxed text-center">
                El acceso a la edición, alta o baja permanente de estudiantes del sistema Santo Domingo Savio requiere la clave de seguridad (<strong>2026</strong>).
              </p>

              {adminError && (
                <div id="admin-error-alert" className="bg-rose-50 text-rose-700 p-3.5 rounded-xl text-xs flex items-center gap-2 border border-rose-100 animate-pulse">
                  <AlertCircle className="h-4.5 w-4.5 text-rose-600 shrink-0" />
                  <span className="font-semibold">{adminError}</span>
                </div>
              )}

              <div className="space-y-2">
                <label htmlFor="admin-pass" className="text-xs font-semibold text-slate-600 uppercase tracking-wide block text-center">
                  Código de Administración
                </label>
                <input
                  id="admin-pass"
                  type="password"
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl px-4 py-3 font-mono text-center text-lg tracking-widest focus:bg-white focus:outline-none focus:ring-2 focus:ring-slate-900"
                  placeholder="••••"
                  maxLength={4}
                  value={adminPassword}
                  onChange={(e) => setAdminPassword(e.target.value)}
                  required
                />
              </div>

              <div className="flex gap-2.5">
                <button
                  type="button"
                  onClick={() => { setShowAdminLockModal(false); setAdminPassword(''); setAdminError(null); }}
                  className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold py-3 rounded-xl text-xs transition border border-slate-200 cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  id="submit-admin-password"
                  type="submit"
                  className="flex-1 bg-slate-900 hover:bg-slate-800 text-white font-semibold py-3 rounded-xl text-xs transition cursor-pointer"
                >
                  Desbloquear
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* CUSTOM IN-APP CONFIRMATION MODAL */}
      {confirmDialog && (
        <div id="custom-confirm-modal" className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden transform animate-in fade-in zoom-in-95 duration-200">
            <div className="bg-slate-950 px-6 py-4.5 text-white flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <AlertCircle className="h-5 w-5 text-amber-400 shrink-0" />
                <span className="font-bold text-sm uppercase tracking-wide">{confirmDialog.title}</span>
              </div>
              <button 
                type="button" 
                onClick={() => setConfirmDialog(null)}
                className="text-slate-400 hover:text-white transition cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-6 space-y-5">
              <p className="text-xs text-slate-600 leading-relaxed whitespace-pre-line">
                {confirmDialog.message}
              </p>

              <div className="flex gap-2.5 pt-1">
                <button
                  type="button"
                  onClick={() => setConfirmDialog(null)}
                  className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold py-3 rounded-xl text-xs transition border border-slate-200 cursor-pointer"
                >
                  {confirmDialog.cancelText}
                </button>
                <button
                  type="button"
                  onClick={confirmDialog.onConfirm}
                  className="flex-1 bg-rose-600 hover:bg-rose-700 text-white font-bold py-3 rounded-xl text-xs transition shadow-md shadow-rose-200/20 cursor-pointer"
                >
                  {confirmDialog.confirmText}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
