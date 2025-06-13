const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');

class MerkleIndexer {
  constructor() {
    this.projectRoot = null;
    this.fileHashes = new Map(); // Maps file path to its hash
    this.projectMerkleRoot = null;
  }

  // Compute a hash for a file's content
  async computeFileHash(filePath) {
    const content = await fs.readFile(filePath, 'utf8');
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  // Compute a Merkle tree for a list of hashes
  computeMerkleTree(hashes) {
    if (hashes.length === 0) return null;
    if (hashes.length === 1) return hashes[0];

    const newLevel = [];
    for (let i = 0; i < hashes.length; i += 2) {
      const left = hashes[i];
      const right = i + 1 < hashes.length ? hashes[i + 1] : left;
      const combined = left + right;
      newLevel.push(crypto.createHash('sha256').update(combined).digest('hex'));
    }
    return this.computeMerkleTree(newLevel);
  }

  // Index a file and update the Merkle tree
  async indexFile(filePath) {
    const hash = await this.computeFileHash(filePath);
    this.fileHashes.set(filePath, hash);
    return hash;
  }

  // Index a directory recursively
  async indexDirectory(dirPath) {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const fileHashes = [];

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        await this.indexDirectory(fullPath);
      } else if (entry.isFile()) {
        const hash = await this.indexFile(fullPath);
        fileHashes.push(hash);
      }
    }

    if (fileHashes.length > 0) {
      const dirHash = this.computeMerkleTree(fileHashes);
      this.fileHashes.set(dirPath, dirHash);
    }
  }

  // Index the entire project
  async indexProject(projectRoot) {
    this.projectRoot = projectRoot;
    await this.indexDirectory(projectRoot);
    this.projectMerkleRoot = this.computeMerkleTree(Array.from(this.fileHashes.values()));
    return this.projectMerkleRoot;
  }

  // Incremental update: reindex only changed files
  async updateIndex() {
    if (!this.projectRoot) throw new Error('Project not indexed yet');
    const newHashes = new Map();
    await this.indexDirectory(this.projectRoot);
    this.projectMerkleRoot = this.computeMerkleTree(Array.from(this.fileHashes.values()));
    return this.projectMerkleRoot;
  }

  // Get the current Merkle root
  getMerkleRoot() {
    return this.projectMerkleRoot;
  }

  // Get the hash for a specific file
  getFileHash(filePath) {
    return this.fileHashes.get(filePath);
  }
}

module.exports = MerkleIndexer; 