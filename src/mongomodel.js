const mongoose = require('mongoose');

const fileSchema = new mongoose.Schema(
    {
        uuid: {
            type: mongoose.SchemaTypes.UUID,
            required: true,
        },
        file_id: {
            type: mongoose.SchemaTypes.String,
            required: true,
        }
    },
    {
        timestamps: {
            createdAt: 'created_at',
            updatedAt: 'updated_at',
        },
    }
);

const File = mongoose.model('File', fileSchema);

module.exports = File;