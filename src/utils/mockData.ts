import { storage } from '@/services/storage';
import { generateId } from './index';
import { FOLDER_COLORS, Post, Folder, Variant } from '@/types';

export const seedMockData = async () => {
    console.log('🌱 Seeding mock data...');

    // 1. Clear existing data
    await storage.savePosts([]);
    await storage.saveFolders([]);
    await storage.saveVariants([]);

    // 2. Create Folders
    const folders: Folder[] = [
        {
            id: generateId(),
            name: 'Personal',
            color: FOLDER_COLORS[0],
            createdAt: Date.now(),
            updatedAt: Date.now(),
        },
        {
            id: generateId(),
            name: 'Work',
            color: FOLDER_COLORS[1],
            createdAt: Date.now(),
            updatedAt: Date.now(),
        },
        {
            id: generateId(),
            name: 'Ideas',
            color: FOLDER_COLORS[2],
            createdAt: Date.now(),
            updatedAt: Date.now(),
        },
        {
            id: generateId(),
            name: 'Tech',
            color: FOLDER_COLORS[3],
            createdAt: Date.now(),
            updatedAt: Date.now(),
        },
        {
            id: generateId(),
            name: 'Random',
            color: FOLDER_COLORS[4],
            createdAt: Date.now(),
            updatedAt: Date.now(),
        },
    ];
    await storage.saveFolders(folders);

    // 3. Create Posts
    const posts: Post[] = [];
    const now = Date.now();

    // Post 1: Draft in Personal folder
    posts.push({
        id: generateId(),
        folderId: folders[0].id,
        sourceContent: 'Just thinking about how AI is changing everything. It is wild!',
        status: 'draft',
        createdAt: now,
        updatedAt: now,
    });

    // Post 2: Draft in Work folder
    posts.push({
        id: generateId(),
        folderId: folders[1].id,
        sourceContent: 'Excited to announce our new feature launch next week! Stay tuned.',
        status: 'draft',
        createdAt: now - 100000,
        updatedAt: now,
    });

    // Post 3: Posted in Tech folder (The one with variants)
    const mainPostId = generateId();
    posts.push({
        id: mainPostId,
        folderId: folders[3].id,
        sourceContent:
            'Optimizing React performance is key for user experience. Use useMemo and useCallback wisely.',
        status: 'posted',
        createdAt: now - 200000,
        updatedAt: now,
    });

    // Post 4: Draft in Ideas (Uncategorized initially, but let's put it in Ideas)
    posts.push({
        id: generateId(),
        folderId: folders[2].id,
        sourceContent: 'Idea for a new app: Uber for dog walkers but with live video feed.',
        status: 'draft',
        createdAt: now - 300000,
        updatedAt: now,
    });

    // Post 5: Draft with no folder
    posts.push({
        id: generateId(),
        folderId: null,
        sourceContent: 'Just a random note about grocery shopping.',
        status: 'draft',
        createdAt: now - 400000,
        updatedAt: now,
    });

    await storage.savePosts(posts);

    // 4. Create Variants for Post 3
    const variants: Variant[] = [
        {
            id: generateId(),
            postId: mainPostId,
            type: 'polish',
            language: null,
            promptTemplate: 'professional',
            content:
                'Enhancing React performance is crucial for a seamless user experience. Implement useMemo and useCallback strategically.',
            description: 'Professional tone',
            isSelected: true,
            createdAt: now,
        },
        {
            id: generateId(),
            postId: mainPostId,
            type: 'polish',
            language: null,
            promptTemplate: 'viral',
            content:
                '🚀 Want faster React apps? Stop re-rendering everything! 🛑 Master useMemo and useCallback now! ⚡️ #ReactJS #WebDev',
            description: 'Viral hook style',
            isSelected: false,
            createdAt: now,
        },
        {
            id: generateId(),
            postId: mainPostId,
            type: 'polish',
            language: null,
            promptTemplate: 'casual',
            content:
                "Hey devs! 👋 Don't forget to optimize your React apps. useMemo and useCallback are your best friends! 😉",
            description: 'Casual friendly',
            isSelected: false,
            createdAt: now,
        },
        {
            id: generateId(),
            postId: mainPostId,
            type: 'translation',
            language: 'es',
            promptTemplate: null,
            content:
                'Optimizar el rendimiento de React es clave para la experiencia del usuario. Usa useMemo y useCallback sabiamente.',
            description: 'Spanish translation',
            isSelected: false,
            createdAt: now,
        },
        {
            id: generateId(),
            postId: mainPostId,
            type: 'translation',
            language: 'zh',
            promptTemplate: null,
            content: '优化 React 性能对用户体验至关重要。明智地使用 useMemo 和 useCallback。',
            description: 'Chinese translation',
            isSelected: false,
            createdAt: now,
        },
    ];

    await storage.saveVariants(variants);

    console.log('✅ Mock data seeded successfully!');
    console.log({ folders, posts, variants });
};
