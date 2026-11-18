import React, { useState } from 'react';
import { Modal, Button } from '@/components/ui';
import { useFoldersStore, useUIStore } from '@/store';
import { useTranslation } from '@/hooks/useTranslation';

export const DeleteFolderModal: React.FC = () => {
    const { isDeleteFolderModalOpen, closeDeleteFolderModal, folderToDeleteId } = useUIStore();
    const { deleteFolder } = useFoldersStore();
    const { t } = useTranslation();
    const [isLoading, setIsLoading] = useState(false);

    const handleDelete = async () => {
        if (!folderToDeleteId) return;

        setIsLoading(true);
        try {
            await deleteFolder(folderToDeleteId);
            closeDeleteFolderModal();
        } catch (error) {
            console.error('Failed to delete folder:', error);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <Modal
            isOpen={isDeleteFolderModalOpen}
            onClose={closeDeleteFolderModal}
            title={t('folder.delete.title')}
            size="sm"
        >
            <div className="space-y-4">
                <p className="text-text-secondary">{t('folder.delete.message')}</p>

                <div className="flex justify-end gap-3 pt-2">
                    <Button variant="ghost" onClick={closeDeleteFolderModal}>
                        {t('actions.cancel')}
                    </Button>
                    <Button
                        variant="primary"
                        className="bg-red-500 hover:bg-red-600 text-white"
                        onClick={handleDelete}
                        isLoading={isLoading}
                    >
                        {t('actions.delete')}
                    </Button>
                </div>
            </div>
        </Modal>
    );
};
