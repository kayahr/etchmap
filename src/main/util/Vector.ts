/*
 * Copyright (C) 2026 Klaus Reimer
 * SPDX-License-Identifier: MIT
 */

/** Immutable three-dimensional vector. */
export class Vector {
    /** Unit vector along the X axis. */
    public static readonly unitX = new Vector(1, 0, 0);

    /** Unit vector along the Y axis. */
    public static readonly unitY = new Vector(0, 1, 0);

    /** Unit vector along the Z axis. */
    public static readonly unitZ = new Vector(0, 0, 1);

    /** Cartesian X component. */
    public readonly x: number;

    /** Cartesian Y component. */
    public readonly y: number;

    /** Cartesian Z component. */
    public readonly z: number;

    /**
     * Creates a vector.
     *
     * @param x - Cartesian X component.
     * @param y - Cartesian Y component.
     * @param z - Cartesian Z component.
     */
    public constructor(x: number, y: number, z: number) {
        this.x = x;
        this.y = y;
        this.z = z;
    }

    /**
     * Creates the cross product with another vector.
     *
     * @param other - Other vector.
     * @returns Cross-product vector.
     */
    public crossProduct(other: Vector): Vector {
        return new Vector(
            this.y * other.z - this.z * other.y,
            this.z * other.x - this.x * other.z,
            this.x * other.y - this.y * other.x
        );
    }

    /**
     * Calculates the dot product with another vector.
     *
     * @param other - Other vector.
     * @returns Scalar dot product.
     */
    public dotProduct(other: Vector): number {
        return this.x * other.x + this.y * other.y + this.z * other.z;
    }

    /** Squared length of this vector. */
    public get squareLength(): number {
        return this.x * this.x + this.y * this.y + this.z * this.z;
    }

    /** Length of this vector. */
    public get length(): number {
        return Math.sqrt(this.squareLength);
    }

    /**
     * Creates a deterministic unit vector perpendicular to this vector.
     *
     * @returns Perpendicular unit vector.
     */
    public orthogonal(): Vector {
        const absoluteX = Math.abs(this.x);
        const absoluteY = Math.abs(this.y);
        const absoluteZ = Math.abs(this.z);
        let reference: Vector;
        if (absoluteZ <= absoluteX && absoluteZ <= absoluteY) {
            reference = Vector.unitZ;
        } else if (absoluteY <= absoluteX) {
            reference = Vector.unitY;
        } else {
            reference = Vector.unitX;
        }
        return reference.crossProduct(this).normalized();
    }

    /**
     * Creates a normalized copy of this vector.
     *
     * @returns Vector scaled to a length of one.
     */
    public normalized(): Vector {
        const length = this.length;
        return new Vector(this.x / length, this.y / length, this.z / length);
    }
}
