import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { UnitTag } from '../entities/unitTag.entity';
import { Unit } from '../../common';
import { CreateUnitTagDto } from '../../../../../../api-dto/unit-tags/create-unit-tag.dto';
import { UpdateUnitTagDto } from '../../../../../../api-dto/unit-tags/update-unit-tag.dto';
import { UnitTagDto } from '../../../../../../api-dto/unit-tags/unit-tag.dto';

@Injectable()
export class UnitTagService {
  constructor(
    @InjectRepository(UnitTag)
    private unitTagRepository: Repository<UnitTag>,
    @InjectRepository(Unit)
    private unitRepository: Repository<Unit>
  ) {}

  /**
   * Create a new unit tag
   * @param createUnitTagDto The data to create the tag with
   * @returns The created tag
   */
  async create(createUnitTagDto: CreateUnitTagDto): Promise<UnitTagDto> {
    // Check if the unit exists
    const unit = await this.unitRepository.findOne({
      where: { id: createUnitTagDto.unitId }
    });

    if (!unit) {
      throw new NotFoundException(`Unit with ID ${createUnitTagDto.unitId} not found`);
    }

    // Create the tag
    const unitTag = this.unitTagRepository.create({
      unitId: createUnitTagDto.unitId,
      tag: createUnitTagDto.tag,
      color: createUnitTagDto.color
    });

    // Save the tag
    const savedTag = await this.unitTagRepository.save(unitTag);

    // Return the DTO
    return {
      id: savedTag.id,
      unitId: savedTag.unitId,
      tag: savedTag.tag,
      color: savedTag.color,
      createdAt: savedTag.createdAt
    };
  }

  /**
   * Find all tags for a unit
   * @param unitId The ID of the unit
   * @returns An array of tags
   */
  async findAllByUnitId(unitId: number): Promise<UnitTagDto[]> {
    // Check if the unit exists
    const unit = await this.unitRepository.findOne({
      where: { id: unitId }
    });

    if (!unit) {
      throw new NotFoundException(`Unit with ID ${unitId} not found`);
    }

    // Find all tags for the unit
    const tags = await this.unitTagRepository.find({
      where: { unitId },
      order: { createdAt: 'DESC' }
    });

    // Return the DTOs
    return tags.map(tag => ({
      id: tag.id,
      unitId: tag.unitId,
      tag: tag.tag,
      color: tag.color,
      createdAt: tag.createdAt
    }));
  }

  /**
   * Find all tags for multiple units in a single query
   * @param unitIds Array of unit IDs
   * @returns An array of tags for all specified units
   */
  async findAllByUnitIds(unitIds: number[]): Promise<UnitTagDto[]> {
    if (!unitIds || unitIds.length === 0) {
      return [];
    }

    // Find all tags for the units in a single query
    const tags = await this.unitTagRepository.find({
      where: { unitId: In(unitIds) },
      order: { createdAt: 'DESC' }
    });

    // Return the DTOs
    return tags.map(tag => ({
      id: tag.id,
      unitId: tag.unitId,
      tag: tag.tag,
      color: tag.color,
      createdAt: tag.createdAt
    }));
  }

  /**
   * Find a tag by ID
   * @param id The ID of the tag
   * @returns The tag
   */
  async findOne(id: number): Promise<UnitTagDto> {
    const tag = await this.unitTagRepository.findOne({
      where: { id }
    });

    if (!tag) {
      throw new NotFoundException(`Tag with ID ${id} not found`);
    }

    return {
      id: tag.id,
      unitId: tag.unitId,
      tag: tag.tag,
      color: tag.color,
      createdAt: tag.createdAt
    };
  }

  /**
   * Update a tag
   * @param id The ID of the tag
   * @param updateUnitTagDto The data to update the tag with
   * @returns The updated tag
   */
  async update(id: number, updateUnitTagDto: UpdateUnitTagDto): Promise<UnitTagDto> {
    const tag = await this.unitTagRepository.findOne({
      where: { id }
    });

    if (!tag) {
      throw new NotFoundException(`Tag with ID ${id} not found`);
    }

    // Update the tag
    tag.tag = updateUnitTagDto.tag;
    if (updateUnitTagDto.color !== undefined) {
      tag.color = updateUnitTagDto.color;
    }

    // Save the tag
    const updatedTag = await this.unitTagRepository.save(tag);

    // Return the DTO
    return {
      id: updatedTag.id,
      unitId: updatedTag.unitId,
      tag: updatedTag.tag,
      color: updatedTag.color,
      createdAt: updatedTag.createdAt
    };
  }

  /**
   * Delete a tag
   * @param id The ID of the tag
   * @returns True if the tag was deleted
   */
  async remove(id: number): Promise<boolean> {
    const tag = await this.unitTagRepository.findOne({
      where: { id }
    });

    if (!tag) {
      throw new NotFoundException(`Tag with ID ${id} not found`);
    }

    const result = await this.unitTagRepository.delete(id);
    return result.affected > 0;
  }
}
