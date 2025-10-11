import {
  collection,
  addDoc,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp,
  where,
  getDocs,
  doc,
  updateDoc,
  increment,
  deleteDoc,
  getDoc,
  setDoc,
  limit,
} from 'firebase/firestore';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage } from '../../../../config/firebase';
import { COLLECTIONS, MEDIA_CONFIG } from '../constants';
import {
  ForumPost,
  ForumComment,
  VoteData,
  NotificationData,
  PostSummary,
  CommentSummary,
} from '../types';
import { openAIService } from './OpenAIService';
import { huggingFaceService } from './HuggingFaceService';

// Posts CRUD operations
export const createPost = async (
  uid: string,
  author: string,
  title: string,
  content: string,
  mediaUrl?: string | null
): Promise<void> => {
  await addDoc(collection(db, COLLECTIONS.FORUM_POSTS), {
    uid,
    author,
    title: title.trim(),
    content: content.trim(),
    createdAt: serverTimestamp(),
    likesCount: 0,
    upVotes: 0,
    downVotes: 0,
    mediaUrl: mediaUrl || null,
  });
};

export const updatePost = async (postId: string, title: string, content: string): Promise<void> => {
  const postRef = doc(db, COLLECTIONS.FORUM_POSTS, postId);
  await updateDoc(postRef, {
    title: title.trim(),
    content: content.trim(),
  });
};

export const deletePost = async (postId: string): Promise<void> => {
  // Delete the post
  await deleteDoc(doc(db, COLLECTIONS.FORUM_POSTS, postId));

  // Delete associated comments
  const commentsQuery = query(
    collection(db, COLLECTIONS.FORUM_COMMENTS),
    where('postId', '==', postId)
  );
  const commentsSnapshot = await getDocs(commentsQuery);
  await Promise.all(
    commentsSnapshot.docs.map(d => deleteDoc(doc(db, COLLECTIONS.FORUM_COMMENTS, d.id)))
  );
};

export const subscribeToPosts = (callback: (posts: ForumPost[]) => void): (() => void) => {
  const postsQuery = query(collection(db, COLLECTIONS.FORUM_POSTS), orderBy('createdAt', 'desc'));

  return onSnapshot(postsQuery, snapshot => {
    const posts: ForumPost[] = snapshot.docs.map(d => ({
      id: d.id,
      ...(d.data() as any),
    }));
    callback(posts);
  });
};

// Comments operations
export const createComment = async (
  postId: string,
  uid: string,
  author: string,
  content: string
): Promise<void> => {
  await addDoc(collection(db, COLLECTIONS.FORUM_COMMENTS), {
    postId,
    uid,
    author,
    content: content.trim(),
    createdAt: serverTimestamp(),
  });
};

export const updateComment = async (commentId: string, content: string): Promise<void> => {
  await updateDoc(doc(db, COLLECTIONS.FORUM_COMMENTS, commentId), {
    content: content.trim(),
  });
};

export const deleteComment = async (commentId: string): Promise<void> => {
  await deleteDoc(doc(db, COLLECTIONS.FORUM_COMMENTS, commentId));
};

export const subscribeToComments = (
  postId: string,
  callback: (comments: ForumComment[]) => void
): (() => void) => {
  const commentsQuery = query(
    collection(db, COLLECTIONS.FORUM_COMMENTS),
    where('postId', '==', postId),
    orderBy('createdAt', 'asc')
  );

  return onSnapshot(commentsQuery, snapshot => {
    const comments: ForumComment[] = snapshot.docs.map(d => ({
      id: d.id,
      ...(d.data() as any),
    }));
    callback(comments);
  });
};

// Voting system
export const vote = async (postId: string, uid: string, value: 1 | -1): Promise<void> => {
  const voteDocRef = doc(db, COLLECTIONS.FORUM_POSTS, postId, COLLECTIONS.VOTES, uid);
  const existingSnap = await getDoc(voteDocRef);
  const prev = existingSnap.exists() ? ((existingSnap.data() as VoteData)?.value ?? null) : null;

  if (prev === value) {
    // Unvote
    await deleteDoc(voteDocRef);
    const fields = value === 1 ? { upVotes: increment(-1) } : { downVotes: increment(-1) };
    await updateDoc(doc(db, COLLECTIONS.FORUM_POSTS, postId), fields);
  } else {
    // Set or switch vote
    const updateFields =
      prev == null
        ? value === 1
          ? { upVotes: increment(1) }
          : { downVotes: increment(1) }
        : value === 1
          ? { upVotes: increment(1), downVotes: increment(-1) }
          : { downVotes: increment(1), upVotes: increment(-1) };

    await updateDoc(doc(db, COLLECTIONS.FORUM_POSTS, postId), updateFields);
    await setDoc(voteDocRef, { value }, { merge: true });
  }
};

export const createNotification = async (
  type: 'upvote' | 'downvote',
  toUid: string,
  fromUid: string,
  postId: string
): Promise<void> => {
  await addDoc(collection(db, COLLECTIONS.NOTIFICATIONS), {
    type,
    toUid,
    fromUid,
    postId,
    createdAt: serverTimestamp(),
  } as Omit<NotificationData, 'id'>);
};

// Media operations
export const uploadMedia = async (uid: string, mediaUri: string): Promise<string> => {
  const response = await fetch(mediaUri);
  const blob = await response.blob();
  const fileName = `${uid}_${Date.now()}`;
  const ref = storageRef(storage, `${MEDIA_CONFIG.STORAGE_PATH}/${uid}/${fileName}`);
  await uploadBytes(ref, blob);
  return await getDownloadURL(ref);
};

// Summarization functions
export const generatePostSummary = async (
  postId: string,
  content: string
): Promise<string | null> => {
  try {
    // FIXED: Use the 'content' parameter that's passed to the function
    const summary = await huggingFaceService.summarizeContent({
      content: content, // Explicitly use the parameter
      type: 'post',
      maxLength: 200,
    });

    if (summary) {
      await addDoc(collection(db, COLLECTIONS.POST_SUMMARIES), {
        postId: postId,
        summary: summary.summary,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      return summary.summary;
    }
    return null;
  } catch (error) {
    console.error('Error generating post summary:', error);
    return null;
  }
};

export const generateCommentSummary = async (
  postId: string,
  comments: ForumComment[]
): Promise<string | null> => {
  try {
    const combinedContent = comments
      .map(comment => `${comment.author}: ${comment.content}`)
      .join('\n\n');

    // FIXED: Use openAIService or switch to huggingFaceService consistently
    const summary = await huggingFaceService.summarizeContent({
      content: combinedContent, // Explicit property assignment
      type: 'comments',
      maxLength: 250,
    });

    if (summary) {
      await addDoc(collection(db, COLLECTIONS.COMMENT_SUMMARIES), {
        postId: postId,
        summary: summary.summary,
        commentCount: comments.length,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      return summary.summary;
    }
    return null;
  } catch (error) {
    console.error('Error generating comment summary:', error);
    return null;
  }
};

// Get summaries
export const getPostSummary = async (postId: string): Promise<PostSummary | null> => {
  try {
    const q = query(
      collection(db, COLLECTIONS.POST_SUMMARIES),
      where('postId', '==', postId),
      orderBy('updatedAt', 'desc'),
      limit(1)
    );

    const snapshot = await getDocs(q);
    if (snapshot.docs[0]) {
      const data = snapshot.docs[0].data();
      return {
        id: snapshot.docs[0].id,
        ...data,
        createdAt: data.createdAt,
        updatedAt: data.updatedAt,
      } as PostSummary;
    }
    return null;
  } catch (error) {
    console.error('Error getting post summary:', error);
    return null;
  }
};

export const getCommentSummary = async (postId: string): Promise<CommentSummary | null> => {
  try {
    const q = query(
      collection(db, COLLECTIONS.COMMENT_SUMMARIES),
      where('postId', '==', postId),
      orderBy('updatedAt', 'desc'),
      limit(1)
    );

    const snapshot = await getDocs(q);
    if (snapshot.docs[0]) {
      const data = snapshot.docs[0].data();
      return {
        id: snapshot.docs[0].id,
        ...data,
        createdAt: data.createdAt,
        updatedAt: data.updatedAt,
      } as CommentSummary;
    }
    return null;
  } catch (error) {
    console.error('Error getting comment summary:', error);
    return null;
  }
};

// Subscribe to summaries
export const subscribeToPostSummary = (
  postId: string,
  callback: (summary: PostSummary | null) => void
): (() => void) => {
  const q = query(
    collection(db, COLLECTIONS.POST_SUMMARIES),
    where('postId', '==', postId),
    orderBy('updatedAt', 'desc'),
    limit(1)
  );

  return onSnapshot(q, snapshot => {
    const summary = snapshot.docs[0]
      ? ({
          id: snapshot.docs[0].id,
          ...snapshot.docs[0].data(),
        } as PostSummary)
      : null;
    callback(summary);
  });
};

export const subscribeToCommentSummary = (
  postId: string,
  callback: (summary: CommentSummary | null) => void
): (() => void) => {
  const q = query(
    collection(db, COLLECTIONS.COMMENT_SUMMARIES),
    where('postId', '==', postId),
    orderBy('updatedAt', 'desc'),
    limit(1)
  );

  return onSnapshot(q, snapshot => {
    const summary = snapshot.docs[0]
      ? ({
          id: snapshot.docs[0].id,
          ...snapshot.docs[0].data(),
        } as CommentSummary)
      : null;
    callback(summary);
  });
};
