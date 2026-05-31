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
  Info
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
  getDocFromServer 
} from 'firebase/firestore';
import { signInAnonymously, onAuthStateChanged } from 'firebase/auth';
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

export default function App() {
  // --- AUTH STATES ---
  const [isAuthorized, setIsAuthorized] = useState<boolean>(() => {
    return localStorage.getItem('sadosa_auth_2026') === 'true';
  });
  const [enteredPassword, setEnteredPassword] = useState<string>('');
  const [authError, setAuthError] = useState<string | null>(null);

  // --- ADMIN (STUDENT MGMT) STATES ---
  const [isAdminAuthorized, setIsAdminAuthorized] = useState<boolean>(false);
  const [adminPassword, setAdminPassword] = useState<string>('');
  const [adminError, setAdminError] = useState<string | null>(null);
  const [showAdminLockModal, setShowAdminLockModal] = useState<boolean>(false);

  // --- CORE SYSTEM DATA STATES (Cloud-backed) ---
  const [students, setStudents] = useState<Student[]>(DEFAULT_STUDENTS);
  const [attendance, setAttendance] = useState<AttendanceRecord>({});
  const [selectedCourse, setSelectedCourse] = useState<string>('1RO A');

  // --- FIREBASE SYNC & CONNECTION ---
  const [firebaseReady, setFirebaseReady] = useState<boolean>(false);
  const [user, setUser] = useState<any>(null);

  // --- DATE & TIME ---
  const [currentDate, setCurrentDate] = useState<string>('2026-05-29'); // Defaults to time in system metadata
  const [activeTab, setActiveTab] = useState<'diario' | 'estudiantes' | 'reportes'>('diario');

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
  const [reportStartDate, setReportStartDate] = useState<string>('2026-05-01');
  const [reportEndDate, setReportEndDate] = useState<string>('2026-05-29');
  const [reportSearchQuery, setReportSearchQuery] = useState<string>('');
  const [reportCourseFilter, setReportCourseFilter] = useState<string>('Todos');

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
          console.error("Please check your Firebase configuration.");
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
          console.error("No se pudo iniciar sesión anónima automáticamente.", error);
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

      // Sort students alphabetically by surname
      const sorted = studentList.sort((a, b) => a.surname.localeCompare(b.surname, 'es'));

      if (sorted.length > 0) {
        setStudents(sorted);
      } else {
        // First initialization seed (We seed first 100, and teacher can trigger full reset from Admin panel)
        DEFAULT_STUDENTS.slice(0, 150).forEach(async (st) => {
          try {
            await setDoc(doc(db, 'students', st.id), {
              id: st.id,
              name: st.name,
              surname: st.surname,
              course: st.course,
              createdAt: new Date().toISOString()
            });
          } catch (e) {
            handleFirestoreError(e, OperationType.WRITE, `students/${st.id}`);
          }
        });
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
        
        if (date && studentId) {
          if (!liveAttendance[date]) {
            liveAttendance[date] = {};
          }
          liveAttendance[date][studentId] = {
            status: item.status || '',
            observation: item.observation || '',
            tags: item.tags || []
          };
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
    if (enteredPassword === 'sadosa2026') {
      setIsAuthorized(true);
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
    if (adminPassword === '2007') {
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
  const saveAttendanceToFirestore = async (studentId: string, status: AttendanceStatus, observation: string, tags: string[]) => {
    const docId = `${currentDate}__${studentId}`;
    try {
      await setDoc(doc(db, 'attendance', docId), {
        id: docId,
        date: currentDate,
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
    setAttendance(prev => {
      const todayRecord = prev[currentDate] || {};
      return {
        ...prev,
        [currentDate]: {
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
    const todayRecord = attendance[currentDate] || {};
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
    const todayRecord = attendance[currentDate] || {};
    const currentStudentRec = todayRecord[studentId] || { status: '', observation: '', tags: [] };
    saveAttendanceStateOptimistic(studentId, status, currentStudentRec.observation, currentStudentRec.tags);
  };

  // --- OBSERVATION TEXT UPDATE ---
  const handleObservationChange = (studentId: string, text: string) => {
    const todayRecord = attendance[currentDate] || {};
    const currentStudentRec = todayRecord[studentId] || { status: '', observation: '', tags: [] };
    saveAttendanceStateOptimistic(studentId, currentStudentRec.status, text, currentStudentRec.tags);
  };

  // --- TAG PILLS SELECTION ---
  const togglePresetTag = (studentId: string, tag: PresetTag) => {
    const todayRecord = attendance[currentDate] || {};
    const currentStudentRec = todayRecord[studentId] || { status: '', observation: '', tags: [] };
    
    const exists = currentStudentRec.tags.includes(tag);
    const updatedTags = exists 
      ? currentStudentRec.tags.filter(t => t !== tag)
      : [...currentStudentRec.tags, tag];

    saveAttendanceStateOptimistic(studentId, currentStudentRec.status, currentStudentRec.observation, updatedTags);
  };

  // --- MASS ASISTENCIA REGISTRATION (RESPETS R, L, F) ---
  const handleMassAttendance = async () => {
    let updatedCount = 0;
    const courseStudents = students.filter(st => st.course === selectedCourse);
    const promises = courseStudents.map(async (st) => {
      const todayRecord = attendance[currentDate] || {};
      const studentRec = todayRecord[st.id] || { status: '', observation: '', tags: [] };
      if (studentRec.status === '') {
        const docId = `${currentDate}__${st.id}`;
        updatedCount++;
        return setDoc(doc(db, 'attendance', docId), {
          id: docId,
          date: currentDate,
          studentId: st.id,
          status: 'A',
          observation: studentRec.observation,
          tags: studentRec.tags,
          updatedAt: new Date().toISOString()
        });
      }
    });

    try {
      await Promise.all(promises);
      showToast(`Control Masivo Completado: ${updatedCount} estudiantes de ${selectedCourse} marcados con Asistencia 'A'.`, 'success');
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
        const todayRecord = attendance[currentDate] || {};
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
      course: newStudentCourse
    };

    try {
      await setDoc(doc(db, 'students', studentId), {
        id: studentId,
        name: newSt.name,
        surname: newSt.surname,
        course: newSt.course,
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
  const handleResetDatabase = async () => {
    if (!window.confirm("¿Está seguro que desea RESTABLECER COMPLETAMENTE la base de datos de estudiantes?\n\nEsto cargará los 762 estudiantes oficiales de la Gestión Escolar 2026 organizados en sus 18 cursos (1RO A hasta 6TO C). Los registros históricos de asistencia se conservarán intactos.")) return;

    setIsSeeding(true);
    setSeedProgress(1);

    try {
      let count = 0;
      for (let i = 0; i < DEFAULT_STUDENTS.length; i++) {
        const st = DEFAULT_STUDENTS[i];
        await setDoc(doc(db, 'students', st.id), {
          id: st.id,
          name: st.name,
          surname: st.surname,
          course: st.course,
          createdAt: new Date().toISOString()
        });
        count++;
        if (count % 35 === 0 || count === DEFAULT_STUDENTS.length) {
          setSeedProgress(Math.round((count / DEFAULT_STUDENTS.length) * 100));
        }
      }
      showToast(`¡Sincronización Exitosa! ${count} estudiantes cargados en los 18 cursos de Secundaria para la Gestión 2026.`, 'success');
    } catch (error) {
      console.error(error);
      showToast("Ocurrió un error sincronizando la base de datos de estudiantes.", "error");
    } finally {
      setIsSeeding(false);
      setSeedProgress(0);
    }
  };

  // --- REMOVE STUDENT WORKER ---
  const handleRemoveStudent = async (id: string, name: string) => {
    if (window.confirm(`¿Está seguro que desea eliminar de forma permanente a: ${name}? Se perderán todos sus registros históricos de asistencia.`)) {
      try {
        await deleteDoc(doc(db, 'students', id));
        showToast(`Estudiante ${name} eliminado.`, 'info');
      } catch (error) {
        handleFirestoreError(error, OperationType.DELETE, `students/${id}`);
      }
    }
  };

  // --- COMPUTE STATISTICS FOR DATE RANGE ---
  const getDatesInRange = (startStr: string, endStr: string) => {
    const dates: string[] = [];
    let current = new Date(startStr);
    const end = new Date(endStr);
    
    // Safety check to prevent infinite loops if dates are invalid
    let maxSteps = 400; // limit report to ~1 year
    while (current <= end && maxSteps > 0) {
      const year = current.getFullYear();
      const month = String(current.getMonth() + 1).padStart(2, '0');
      const day = String(current.getDate()).padStart(2, '0');
      dates.push(`${year}-${month}-${day}`);
      current.setDate(current.getDate() + 1);
      maxSteps--;
    }
    return dates;
  };

  const reportDates = getDatesInRange(reportStartDate, reportEndDate);

  const getStudentStats = (studentId: string) => {
    let A = 0, R = 0, L = 0, F = 0, unchecked = 0;
    const obsList: { date: string; text: string; tags: string[] }[] = [];

    reportDates.forEach(d => {
      const dayRec = attendance[d]?.[studentId];
      if (dayRec) {
        if (dayRec.status === 'A') A++;
        else if (dayRec.status === 'R') R++;
        else if (dayRec.status === 'L') L++;
        else if (dayRec.status === 'F') F++;
        else unchecked++;

        // Save observations if any exist on this day
        if (dayRec.observation.trim() || dayRec.tags.length > 0) {
          obsList.push({
            date: d,
            text: dayRec.observation,
            tags: dayRec.tags
          });
        }
      } else {
        unchecked++;
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
      doc.text(`Gestión Escolar 2026 | Rango: ${reportStartDate} al ${reportEndDate} | Curso: ${reportCourseFilter}`, 105, 26, { align: 'center' });
      
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
      <div className="min-h-screen flex items-center justify-center bg-slate-100 p-4 font-sans selection:bg-slate-300 selection:text-slate-900">
        <div id="login-container" className="w-full max-w-md bg-white rounded-2xl shadow-xl overflow-hidden border border-slate-200 transition-all duration-300">
          <div className="bg-slate-900 px-6 py-8 text-white text-center relative">
            <div className="absolute top-4 left-4 bg-slate-800 text-yellow-500 text-xs px-2.5 py-1 rounded-full font-mono font-bold uppercase tracking-wider">
              Bolivia 2026
            </div>
            <div className="flex justify-center mb-3 mt-2">
              <div className="bg-slate-800 p-3.5 rounded-full ring-4 ring-yellow-500/20">
                <GraduationCap className="h-8 w-8 text-yellow-500" />
              </div>
            </div>
            <h1 className="text-xl font-bold tracking-tight">U. E. SANTO DOMINGO SAVIO</h1>
            <p className="text-xs text-slate-300 mt-1 uppercase tracking-widest font-mono">Nivel Secundario</p>
          </div>

          <form onSubmit={handleLoginSubmit} className="p-6 sm:p-8 space-y-6">
            <div className="text-center">
              <h2 className="text-lg font-semibold text-slate-800">Control de Asistencia General</h2>
              <p className="text-xs text-slate-500 mt-1">Ingrese la clave de acceso institucional para registrar y ver el historial</p>
            </div>

            {authError && (
              <div id="auth-error-alert" className="bg-rose-50 text-rose-700 p-3.5 rounded-xl text-xs flex items-center gap-3 border border-rose-100 animate-pulse">
                <AlertCircle className="h-4.5 w-4.5 shrink-0 text-rose-600" />
                <span className="font-medium">{authError}</span>
              </div>
            )}

            <div className="space-y-2">
              <label htmlFor="auth-password" className="text-xs font-semibold text-slate-700 uppercase tracking-wider block">
                Clave de Ingreso
              </label>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center text-slate-400">
                  <Lock className="h-4.5 w-4.5" />
                </span>
                <input
                  id="auth-password"
                  type="password"
                  className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-300 rounded-xl font-mono text-center tracking-widest focus:bg-white focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent transition-all"
                  placeholder="••••••••••••"
                  value={enteredPassword}
                  onChange={(e) => setEnteredPassword(e.target.value)}
                  required
                />
              </div>
            </div>

            <button
              id="login-button"
              type="submit"
              className="w-full bg-slate-900 hover:bg-slate-800 text-white py-3.5 rounded-xl font-semibold transition-all duration-150 flex items-center justify-center gap-2 shadow-lg shadow-slate-900/10 cursor-pointer"
            >
              <Unlock className="h-4 w-4 text-slate-400" />
              <span>Ingresar al Sistema</span>
            </button>

            <div className="text-center pt-2 border-t border-slate-100">
              <span className="text-[10px] text-slate-400 uppercase tracking-widest font-mono">
                Gestión 2026 • Santo Domingo Savio
              </span>
            </div>
          </form>
        </div>
      </div>
    );
  }

  // --- STATS CALCULATION FOR CURRENT COURSE AND SELECTED DATE ---
  const courseStudents = students.filter(st => st.course === selectedCourse);
  let countA = 0;
  let countR = 0;
  let countL = 0;
  let countF = 0;
  let countSinRegistrar = 0;

  courseStudents.forEach(st => {
    const status = attendance[currentDate]?.[st.id]?.status || '';
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
                <h1 className="text-xl font-bold tracking-tight">UE SANTO DOMINGO SAVIO</h1>
                <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 mt-0.5 text-xs text-slate-400">
                  <span className="font-semibold text-yellow-400">Nivel Secundario</span>
                  <span>•</span>
                  <span className="font-mono text-slate-300">Gestión Escolar 2026</span>
                  <span>•</span>
                  <span className="bg-slate-800 px-2.5 py-0.5 rounded text-[10px] text-slate-300 uppercase tracking-widest border border-slate-700">Bolivia</span>
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
            
            {/* CURSO SELECTOR (LISTA DESPLEGABLE) */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 sm:p-5">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div className="flex items-center gap-2.5">
                  <div className="bg-slate-100 p-2 rounded-xl text-slate-900 border border-slate-200">
                    <GraduationCap className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="font-extrabold text-slate-900 text-xs uppercase tracking-wide">CURSO SECUNDARIA SELECCIONADO</h3>
                    <p className="text-[10px] text-slate-400 mt-0.5">Seleccione el curso de secundaria para el control de asistencia diario</p>
                  </div>
                </div>

                <div className="relative w-full sm:w-80">
                  <select
                    id="main-course-dropdown-selector"
                    value={selectedCourse}
                    onChange={(e) => {
                      const course = e.target.value;
                      setSelectedCourse(course);
                      setNewStudentCourse(course); // Keep in sync for bulk/individual additions
                    }}
                    className="w-full appearance-none bg-slate-900 text-amber-400 font-extrabold px-4 py-3 pr-10 text-xs rounded-xl border border-slate-950 shadow-md ring-2 ring-yellow-400/30 hover:bg-slate-850 focus:outline-none transition-all cursor-pointer"
                  >
                    {COURSES.map((course) => {
                      const count = students.filter(st => st.course === course).length;
                      return (
                        <option key={course} value={course} className="bg-slate-900 text-white font-bold py-2 text-xs">
                          {course} ({count} alumnos registrados)
                        </option>
                      );
                    })}
                  </select>
                  <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none text-amber-400">
                    <ChevronDown className="h-4.5 w-4.5" />
                  </div>
                </div>
              </div>
            </div>

            {/* CONTROL PANEL CARD */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-5">
              
              {/* Left hand side: Date adjusters */}
              <div className="flex flex-col sm:flex-row sm:items-center gap-3.5">
                <div className="bg-slate-100 p-2.5 rounded-xl shrink-0 text-slate-800 font-bold text-xs uppercase flex items-center gap-2">
                  <Calendar className="h-4.5 w-4.5 text-slate-600" />
                  <span>REGISTRO DE FECHA</span>
                </div>
                
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => handleShiftDate(-1)}
                    className="p-2.5 bg-slate-50 border border-slate-200 rounded-lg hover:bg-slate-100 text-slate-600 transition"
                    title="Día Anterior"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  
                  <input
                    id="date-selector"
                    type="date"
                    className="bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-900"
                    value={currentDate}
                    onChange={(e) => setCurrentDate(e.target.value)}
                  />

                  <button
                    onClick={() => handleShiftDate(1)}
                    className="p-2.5 bg-slate-50 border border-slate-200 rounded-lg hover:bg-slate-100 text-slate-600 transition"
                    title="Día Siguiente"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {/* Center right: Bulk assistance option */}
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 flex flex-all flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="max-w-md">
                  <span className="text-xs font-bold text-slate-800 block uppercase">Control Masivo de Asistencia ({selectedCourse})</span>
                  <span className="text-[10.5px] text-slate-500 leading-tight block mt-0.5">
                    Rellena todos los sin registrar como <span className="font-bold text-emerald-600">A (Asistencia)</span>, respetando estrictamente a quienes ya tengan un Retraso (R), Licencia (L) o Falta (F).
                  </span>
                </div>
                <button
                  id="btn-bulk-attendance"
                  onClick={handleMassAttendance}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg px-4.5 py-2.5 text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer select-none border-b-2 border-emerald-800"
                >
                  <CheckCircle className="h-4.5 w-4.5" />
                  <span>Registrar Masivo</span>
                </button>
              </div>

            </div>

            {/* REAL-TIME STATS ROW (CURSO SELECCIONADO) */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 sm:p-5 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-slate-100 pb-2.5">
                <div className="flex items-center gap-2 text-slate-755">
                  <span className="text-[10px] font-extrabold uppercase tracking-wider font-mono text-slate-500">RESUMEN DE ASISTENCIA</span>
                </div>
                <div className="text-xs text-slate-600 bg-slate-100 px-3.5 py-1.5 rounded-xl font-bold flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-slate-400 animate-pulse"></span>
                  <span>Total Estudiantes Registrados: <span className="text-slate-900 font-black font-mono text-sm">{courseStudents.length}</span></span>
                </div>
              </div>

              {/* REAL-TIME STATS SHELF FOR SELECTED COURSE ON CURRENT DATE */}
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 sm:p-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                <div className="bg-white border border-slate-150 rounded-lg p-3 shadow-xs flex flex-col justify-center">
                  <span className="text-[10px] font-extrabold text-slate-500 uppercase tracking-wider">Asistencia (A)</span>
                  <span className="text-xl font-bold text-emerald-600 font-mono mt-0.5">{countA} <span className="text-xs text-slate-400 font-normal">est.</span></span>
                </div>
                <div className="bg-white border border-slate-150 rounded-lg p-3 shadow-xs flex flex-col justify-center">
                  <span className="text-[10px] font-extrabold text-slate-500 uppercase tracking-wider">Retrasos (R)</span>
                  <span className="text-xl font-bold text-amber-500 font-mono mt-0.5">{countR} <span className="text-xs text-slate-400 font-normal">est.</span></span>
                </div>
                <div className="bg-white border border-slate-150 rounded-lg p-3 shadow-xs flex flex-col justify-center">
                  <span className="text-[10px] font-extrabold text-slate-500 uppercase tracking-wider">Licencias (L)</span>
                  <span className="text-xl font-bold text-sky-500 font-mono mt-0.5">{countL} <span className="text-xs text-slate-400 font-normal">est.</span></span>
                </div>
                <div className="bg-white border border-slate-150 rounded-lg p-3 shadow-xs flex flex-col justify-center">
                  <span className="text-[10px] font-extrabold text-slate-500 uppercase tracking-wider">Faltas (F)</span>
                  <span className="text-xl font-bold text-rose-500 font-mono mt-0.5">{countF} <span className="text-xs text-slate-400 font-normal">est.</span></span>
                </div>
                <div className="bg-white border border-slate-150 rounded-lg p-3 shadow-xs flex flex-col justify-center">
                  <span className="text-[10px] font-extrabold text-slate-505 uppercase tracking-wider">Sin Registrar</span>
                  <span className="text-xl font-bold text-slate-400 font-mono mt-0.5">{countSinRegistrar} <span className="text-xs text-slate-400 font-normal">est.</span></span>
                </div>
                <div className="bg-slate-900 border border-slate-950 rounded-lg p-3 shadow-xs flex flex-col justify-center">
                  <span className="text-[10.5px] font-black text-amber-400 uppercase tracking-wider">TOTAL ASISTENTES (A+R)</span>
                  <span className="text-2xl font-black text-white font-mono mt-0.5">{totalAsistentesReal} <span className="text-xs text-slate-300 font-medium">alumnos</span></span>
                </div>
              </div>

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
                  const studentAttendance = attendance[currentDate]?.[student.id] || { status: '', observation: '', tags: [] };
                  const isListening = listeningStudentId === student.id;

                  return (
                    <div 
                      key={student.id} 
                      className="bg-white rounded-2xl border border-slate-200 hover:border-slate-300 p-4 shadow-xs transition-all flex flex-col md:flex-row md:items-center justify-between gap-4"
                    >
                      {/* Left Block: Index, student name */}
                      <div className="flex items-center gap-4 min-w-[280px]">
                        <span className="h-7 w-7 rounded-lg bg-slate-100 text-slate-500 font-mono text-center flex items-center justify-center text-xs font-bold">
                          {String(index + 1).padStart(2, '0')}
                        </span>
                        <div>
                          <h4 className="font-bold text-slate-900 group-hover:text-amber-600 text-[14.5px]">
                            {student.surname}
                          </h4>
                          <p className="text-xs font-semibold text-slate-400">{student.name}</p>
                        </div>
                      </div>

                      {/* Middle Block: UNIFIED STATE BUBBLE INTERFACE (Tap to Cycle) */}
                      <div className="flex items-center gap-3 shrink-0">
                        <div className="flex flex-col items-center gap-1">
                          <button
                            type="button"
                            onClick={() => cycleAttendance(student.id)}
                            className={`h-12 w-12 sm:h-14 sm:w-14 rounded-full font-black text-sm sm:text-base flex items-center justify-center transition-all transform hover:scale-110 active:scale-95 cursor-pointer shadow-sm select-none border-2 border-transparent ${
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
                            title="Tocar para alternar: Sin marcar -> A -> R -> L -> F"
                          >
                            {studentAttendance.status || '•'}
                          </button>
                        </div>
                        
                        <div className="hidden lg:flex flex-col text-[10px] text-slate-400 leading-tight">
                          <span className={`${studentAttendance.status === 'A' ? 'text-emerald-600 font-bold' : ''}`}>A: Asistencia</span>
                          <span className={`${studentAttendance.status === 'R' ? 'text-amber-550 font-bold' : ''}`}>R: Retraso</span>
                          <span className={`${studentAttendance.status === 'L' ? 'text-sky-600 font-bold' : ''}`}>L: Licencia</span>
                          <span className={`${studentAttendance.status === 'F' ? 'text-rose-600 font-bold' : ''}`}>F: Falta</span>
                        </div>
                      </div>

                      {/* Right Block: DETAILED OBSERVATIONS & SPEECH & PRESETS */}
                      <div className="flex-1 space-y-2.5">
                        
                        {/* Text input row using our enhanced local observer input */}
                        <StudentObservationInput 
                          studentId={student.id}
                          value={studentAttendance.observation}
                          onSave={handleObservationChange}
                          isListening={isListening}
                          onVoiceToggle={() => handleVoiceToggle(student.id)}
                        />

                        {/* PRESETS DROP BUBBLE FOR REQUIRED CRITERIA */}
                        <div className="flex flex-wrap items-center gap-2 pt-1">
                          <span className="text-[10px] font-bold text-slate-400 uppercase">Observación Rápida:</span>
                          <StudentPresetDropdown 
                            selectedTags={studentAttendance.tags}
                            onToggleTag={(tag) => togglePresetTag(student.id, tag)}
                          />
                        </div>

                      </div>
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

        {/* TAB 2: GESTION DE ESTUDIANTES (PROTECTED BY PASSCODE "2007") */}
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
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                
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
                El acceso a la edición, alta o baja permanente de estudiantes del sistema Santo Domingo Savio requiere la clave de seguridad del director.
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

    </div>
  );
}
