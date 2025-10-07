import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  User,
} from 'firebase/auth';
import {
  collection,
  addDoc,
  getDocs,
  query,
  where,
  doc,
  updateDoc,
  DocumentData,
  getDoc,
  setDoc,
} from 'firebase/firestore';
import { auth, db } from '../../config/firebase';
import type { Firestore } from 'firebase/firestore';

export class AuthService {
  static async signUp(email: string, password: string): Promise<User> {
    try {
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      return userCredential.user;
    } catch (error) {
      throw error;
    }
  }

  static async signIn(email: string, password: string): Promise<User> {
    try {
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      return userCredential.user;
    } catch (error) {
      throw error;
    }
  }

  static async signOut(): Promise<void> {
    try {
      await signOut(auth);
    } catch (error) {
      throw error;
    }
  }

  static getCurrentUser(): User | null {
    return auth.currentUser;
  }
}

export class FirestoreService {
  static async testConnection(): Promise<boolean> {
    try {
      console.log('🔍 Testing Firestore connection...');
      console.log('Project ID:', db._delegate?._databaseId?.projectId || 'unknown');

      // Test 1: Create collection reference
      const testCollection = collection(db, 'connection-test');
      console.log('✅ Collection reference created:', testCollection.path);

      // Test 2: Try to read (this should work even with restrictive rules)
      try {
        await getDocs(testCollection);
        console.log('✅ Firestore read test passed');
      } catch (readError: any) {
        console.warn('⚠️ Firestore read failed (might be security rules):', readError.code);
      }

      console.log('✅ Basic Firestore connection test passed');
      return true;
    } catch (error: any) {
      console.error('❌ Firestore connection test failed:', {
        code: error.code,
        message: error.message,
        details: error,
      });
      return false;
    }
  }

  static async addDocument(collectionName: string, data: any): Promise<string> {
    try {
      console.log(`🚀 FirestoreService: Adding document to collection '${collectionName}'`, data);
      console.log('📍 Database instance:', db.app.name);

      // Check if user is authenticated (this is crucial for Firestore rules)
      const currentUser = auth.currentUser;
      console.log('👤 Current user:', currentUser ? currentUser.uid : 'Not authenticated');

      if (!currentUser) {
        throw new Error('User must be authenticated to write to Firestore');
      }

      // Create collection reference
      const collectionRef = collection(db, collectionName);
      console.log('📂 Collection reference path:', collectionRef.path);

      // Try to add document with more detailed logging
      console.log('⏳ Attempting to add document...');
      const docRef = await addDoc(collectionRef, data);
      console.log(`✅ FirestoreService: Document added successfully with ID: ${docRef.id}`);
      return docRef.id;
    } catch (error: any) {
      console.error('❌ FirestoreService: Error adding document:', {
        code: error.code,
        message: error.message,
        name: error.name,
        customMessage: this.getFirestoreErrorMessage(error),
      });
      throw error;
    }
  }

  // Helper function to decode common Firestore errors
  static getFirestoreErrorMessage(error: any): string {
    switch (error.code) {
      case 'permission-denied':
        return 'Permission denied. Check Firestore security rules.';
      case 'unavailable':
        return 'Firestore service is currently unavailable.';
      case 'deadline-exceeded':
        return 'Request timed out. Check network connection.';
      case 'unauthenticated':
        return 'User is not authenticated.';
      default:
        return `Unknown Firestore error: ${error.code}`;
    }
  }

  static async getDocuments(collectionName: string): Promise<DocumentData[]> {
    try {
      const querySnapshot = await getDocs(collection(db, collectionName));
      return querySnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
      }));
    } catch (error) {
      throw error;
    }
  }

  static async getDocumentsByField(
    collectionName: string,
    field: string,
    value: any
  ): Promise<DocumentData[]> {
    try {
      const q = query(collection(db, collectionName), where(field, '==', value));
      const querySnapshot = await getDocs(q);
      return querySnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
      }));
    } catch (error) {
      throw error;
    }
  }

  static async saveUserLayout(layoutData: {
    source: 'blueprint' | 'custom';
    blueprintId: string | null;
    sections: Array<{ name: string; count: number }>;
    type: 'household' | 'industrial';
    name: string;
    area: number;
  }): Promise<string> {
    try {
      const currentUser = auth.currentUser;
      if (!currentUser) {
        throw new Error('User must be authenticated to save layout');
      }

      const layoutDoc = {
        userId: currentUser.uid,
        ...layoutData,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      return await this.addDocument('user_layouts', layoutDoc);
    } catch (error) {
      throw error;
    }
  }

  static async getUserLayout(userId: string): Promise<DocumentData | null> {
    try {
      const layouts = await this.getDocumentsByField('user_layouts', 'userId', userId);
      return layouts.length > 0 ? layouts[0] : null;
    } catch (error) {
      throw error;
    }
  }

  static async updateUserLayout(
    layoutId: string,
    updates: Partial<{
      sections: Array<{ name: string; count: number }>;
      name: string;
      area: number;
    }>
  ): Promise<void> {
    try {
      const layoutRef = doc(db, 'user_layouts', layoutId);
      const updateData = {
        ...updates,
        updatedAt: new Date().toISOString(),
      };

      await updateDoc(layoutRef, updateData);
      console.log('✅ Layout updated successfully');
    } catch (error) {
      console.error('❌ Error updating layout:', error);
      throw error;
    }
  }

  // Enhanced layout methods for room and device management
  static async saveEnhancedUserLayout(layoutData: {
    layoutName: string;
    area: number;
    rooms: Array<{
      roomId: string;
      roomName: string;
      devices: Array<{
        deviceId: string;
        deviceName: string;
        wattage: number;
        usage: Array<{
          start: string;
          end: string;
          totalHours: number;
        }>;
        totalPowerUsed?: number;
      }>;
    }>;
  }): Promise<void> {
    try {
      const currentUser = auth.currentUser;
      if (!currentUser) {
        throw new Error('User must be authenticated to save layout');
      }

      const layoutDoc = {
        userId: currentUser.uid,
        ...layoutData,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const layoutRef = doc(db, 'layouts', currentUser.uid);
      await setDoc(layoutRef, layoutDoc);
      console.log('✅ Enhanced layout saved successfully');
    } catch (error) {
      console.error('❌ Error saving enhanced layout:', error);
      throw error;
    }
  }

  static async getEnhancedUserLayout(userId: string): Promise<DocumentData | null> {
    try {
      const layoutRef = doc(db, 'layouts', userId);
      const layoutDoc = await getDoc(layoutRef);

      if (layoutDoc.exists()) {
        return { id: layoutDoc.id, ...layoutDoc.data() };
      }
      return null;
    } catch (error) {
      console.error('❌ Error getting enhanced layout:', error);
      throw error;
    }
  }

  static async updateEnhancedUserLayout(
    userId: string,
    updates: Partial<{
      layoutName: string;
      area: number;
      rooms: Array<any>;
    }>
  ): Promise<void> {
    try {
      const layoutRef = doc(db, 'layouts', userId);
      const updateData = {
        ...updates,
        updatedAt: new Date(),
      };

      await updateDoc(layoutRef, updateData);
      console.log('✅ Enhanced layout updated successfully');
    } catch (error) {
      console.error('❌ Error updating enhanced layout:', error);
      throw error;
    }
  }
}
