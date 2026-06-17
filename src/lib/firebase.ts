import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
const configAny = firebaseConfig as any;
export const db = configAny.firestoreDatabaseId 
  ? getFirestore(app, configAny.firestoreDatabaseId) 
  : getFirestore(app);
export const auth = getAuth(app);
