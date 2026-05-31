export interface Student {
  id: string;
  name: string;
  surname: string;
  course: string;
}

export type AttendanceStatus = 'A' | 'R' | 'L' | 'F' | '';

export interface StudentAttendance {
  status: AttendanceStatus;
  observation: string;
  tags: string[]; // 'No presentó cuaderno', 'No presentó trabajo', 'No participó en clases', 'Genera indisciplina en el aula'
}

// Record<dateString (YYYY-MM-DD), Record<studentId, StudentAttendance>>
export type AttendanceRecord = Record<string, Record<string, StudentAttendance>>;

export const PRESET_TAGS = [
  'No presento cuaderno',
  'No presento trabajo',
  'No participo en clases',
  'Genera indisciplina en el aula'
] as const;

export type PresetTag = typeof PRESET_TAGS[number];
