import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { UnitNote } from '../entities/unitNote.entity';
import { Unit } from '../entities/unit.entity';
import { CreateUnitNoteDto } from '../../../../../../api-dto/unit-notes/create-unit-note.dto';
import { UpdateUnitNoteDto } from '../../../../../../api-dto/unit-notes/update-unit-note.dto';
import { UnitNoteDto } from '../../../../../../api-dto/unit-notes/unit-note.dto';

@Injectable()
export class UnitNoteService {
  constructor(
    @InjectRepository(UnitNote)
    private unitNoteRepository: Repository<UnitNote>,
    @InjectRepository(Unit)
    private unitRepository: Repository<Unit>
  ) {}

  /**
   * Create a new unit note
   * @param createUnitNoteDto The data to create the note with
   * @returns The created note
   */
  async create(createUnitNoteDto: CreateUnitNoteDto): Promise<UnitNoteDto> {
    const unit = await this.unitRepository.findOne({
      where: { id: createUnitNoteDto.unitId }
    });

    if (!unit) {
      throw new NotFoundException(`Unit with ID ${createUnitNoteDto.unitId} not found`);
    }

    const unitNote = this.unitNoteRepository.create({
      unitId: createUnitNoteDto.unitId,
      note: createUnitNoteDto.note
    });

    const savedNote = await this.unitNoteRepository.save(unitNote);

    return {
      id: savedNote.id,
      unitId: savedNote.unitId,
      note: savedNote.note,
      createdAt: savedNote.createdAt,
      updatedAt: savedNote.updatedAt
    };
  }

  /**
   * Find all notes for a unit
   * @param unitId The ID of the unit
   * @returns An array of notes
   */
  async findAllByUnitId(unitId: number): Promise<UnitNoteDto[]> {
    const unit = await this.unitRepository.findOne({
      where: { id: unitId }
    });

    if (!unit) {
      throw new NotFoundException(`Unit with ID ${unitId} not found`);
    }

    const notes = await this.unitNoteRepository.find({
      where: { unitId },
      order: { createdAt: 'DESC' }
    });

    return notes.map(note => ({
      id: note.id,
      unitId: note.unitId,
      note: note.note,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt
    }));
  }

  /**
   * Find a note by ID
   * @param id The ID of the note
   * @returns The note
   */
  async findOne(id: number): Promise<UnitNoteDto> {
    const note = await this.unitNoteRepository.findOne({
      where: { id }
    });

    if (!note) {
      throw new NotFoundException(`Note with ID ${id} not found`);
    }

    return {
      id: note.id,
      unitId: note.unitId,
      note: note.note,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt
    };
  }

  /**
   * Update a note
   * @param id The ID of the note
   * @param updateUnitNoteDto The data to update the note with
   * @returns The updated note
   */
  async update(id: number, updateUnitNoteDto: UpdateUnitNoteDto): Promise<UnitNoteDto> {
    const note = await this.unitNoteRepository.findOne({
      where: { id }
    });

    if (!note) {
      throw new NotFoundException(`Note with ID ${id} not found`);
    }

    note.note = updateUnitNoteDto.note;

    const updatedNote = await this.unitNoteRepository.save(note);

    return {
      id: updatedNote.id,
      unitId: updatedNote.unitId,
      note: updatedNote.note,
      createdAt: updatedNote.createdAt,
      updatedAt: updatedNote.updatedAt
    };
  }

  /**
   * Delete a note
   * @param id The ID of the note
   * @returns True if the note was deleted
   */
  async remove(id: number): Promise<boolean> {
    const note = await this.unitNoteRepository.findOne({
      where: { id }
    });

    if (!note) {
      throw new NotFoundException(`Note with ID ${id} not found`);
    }

    const result = await this.unitNoteRepository.delete(id);
    return result.affected > 0;
  }

  /**
   * Find all notes for multiple units
   * @param unitIds Array of unit IDs
   * @returns An array of notes grouped by unit ID
   */
  async findAllByUnitIds(unitIds: number[]): Promise<{ [unitId: number]: UnitNoteDto[] }> {
    if (!unitIds || unitIds.length === 0) {
      return {};
    }

    const notes = await this.unitNoteRepository.find({
      where: { unitId: In(unitIds) },
      order: { createdAt: 'DESC' }
    });

    const notesByUnitId: { [unitId: number]: UnitNoteDto[] } = {};

    notes.forEach(note => {
      if (!notesByUnitId[note.unitId]) {
        notesByUnitId[note.unitId] = [];
      }

      notesByUnitId[note.unitId].push({
        id: note.id,
        unitId: note.unitId,
        note: note.note,
        createdAt: note.createdAt,
        updatedAt: note.updatedAt
      });
    });

    return notesByUnitId;
  }
}
