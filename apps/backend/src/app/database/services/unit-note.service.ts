import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
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
    // Check if the unit exists
    const unit = await this.unitRepository.findOne({
      where: { id: createUnitNoteDto.unitId }
    });

    if (!unit) {
      throw new NotFoundException(`Unit with ID ${createUnitNoteDto.unitId} not found`);
    }

    // Create the note
    const unitNote = this.unitNoteRepository.create({
      unitId: createUnitNoteDto.unitId,
      note: createUnitNoteDto.note
    });

    // Save the note
    const savedNote = await this.unitNoteRepository.save(unitNote);

    // Return the DTO
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
    // Check if the unit exists
    const unit = await this.unitRepository.findOne({
      where: { id: unitId }
    });

    if (!unit) {
      throw new NotFoundException(`Unit with ID ${unitId} not found`);
    }

    // Find all notes for the unit
    const notes = await this.unitNoteRepository.find({
      where: { unitId },
      order: { createdAt: 'DESC' }
    });

    // Return the DTOs
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

    // Update the note
    note.note = updateUnitNoteDto.note;

    // Save the note
    const updatedNote = await this.unitNoteRepository.save(note);

    // Return the DTO
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
}
